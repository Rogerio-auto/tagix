/**
 * F69-S03 — o webhook aceita leads de anúncio (objeto `page`, campo `leadgen`).
 *
 * Protege: lead autenticado é enfileirado; falha no enqueue devolve 503 para a Meta
 * reentregar (lead pago não se perde no ack); assinatura inválida continua 403.
 */
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const APP_SECRET = 'leadgen_test_secret';

const publishLeadgen = vi.fn((_n: unknown): Promise<boolean> => Promise.resolve(true));
const publishInboundMessage = vi.fn((_p: unknown): Promise<boolean> => Promise.resolve(true));

vi.mock('../../secrets', () => ({
  platformSecrets: { get: (key: string) => (key === 'meta_app_secret' ? APP_SECRET : undefined) },
}));
vi.mock('./dedup', () => ({
  registerWebhookEvent: vi.fn(async () => true),
  hasWebhookEvent: vi.fn(async () => false),
  recordWebhookRedelivery: vi.fn(),
}));
vi.mock('./publisher', () => ({
  publishInboundMessage,
  publishCoexistenceEcho: vi.fn(async () => true),
  publishHistoryBatch: vi.fn(async () => true),
  publishAppState: vi.fn(async () => true),
}));
vi.mock('../../services/meta/leadgen/publish', () => ({ publishLeadgen }));
vi.mock('../flows/submissions', () => ({
  createSubmissionDeps: () => ({}),
  processMetaFlowSubmission: async () => undefined,
}));

const { createMetaWebhookRouter } = await import('./meta');

function sign(raw: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(Buffer.from(raw, 'utf8')).digest('hex')}`;
}

async function post(body: Record<string, unknown>, assinatura?: string): Promise<number> {
  const raw = JSON.stringify(body);
  const app = express();
  app.use(createMetaWebhookRouter());
  const res = await request(app)
    .post('/webhooks/meta')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', assinatura ?? sign(raw))
    .send(raw);
  return res.status;
}

const LEAD = {
  object: 'page',
  entry: [
    {
      id: 'pg1',
      time: 1_790_000_000,
      changes: [
        {
          field: 'leadgen',
          value: { leadgen_id: 'lg1', page_id: 'pg1', form_id: 'f1', ad_id: 'ad1', created_time: 1_790_000_000 },
        },
        {
          field: 'leadgen',
          value: { leadgen_id: 'lg2', page_id: 'pg1', form_id: 'f1', created_time: 1_790_000_001 },
        },
      ],
    },
  ],
};

describe('POST /webhooks/meta — leads de anúncio', () => {
  beforeEach(() => {
    publishLeadgen.mockReset();
    publishLeadgen.mockResolvedValue(true);
    publishInboundMessage.mockClear();
  });

  it('enfileira cada lead e responde 200', async () => {
    expect(await post(LEAD)).toBe(200);
    expect(publishLeadgen).toHaveBeenCalledTimes(2);
    expect(publishLeadgen.mock.calls[0]?.[0]).toMatchObject({ leadgenId: 'lg1', pageId: 'pg1', formId: 'f1' });
    expect(publishInboundMessage).not.toHaveBeenCalled();
  });

  it('broker recusou → 503 para a Meta reentregar', async () => {
    publishLeadgen.mockResolvedValueOnce(false);
    expect(await post(LEAD)).toBe(503);
  });

  it('broker fora → 503', async () => {
    publishLeadgen.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await post(LEAD)).toBe(503);
  });

  it('objeto page sem leadgen: ack sem publicar', async () => {
    expect(await post({ object: 'page', entry: [{ id: 'pg1', changes: [{ field: 'feed', value: {} }] }] })).toBe(200);
    expect(publishLeadgen).not.toHaveBeenCalled();
  });

  it('assinatura inválida continua 403 e não publica', async () => {
    expect(await post(LEAD, 'sha256=deadbeef')).toBe(403);
    expect(publishLeadgen).not.toHaveBeenCalled();
  });
});
