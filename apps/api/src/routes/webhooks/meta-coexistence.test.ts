/**
 * Teste de ingestão de coexistência no webhook unificado (F39-S03). Verifica que
 * `/webhooks/meta` reconhece smb_message_echoes / history / smb_app_state_sync e
 * publica os eventos tipados certos (publisher mockado), e que envelopes sem
 * campos de coexistência NÃO publicam coexistência — sempre ack 200.
 *
 * Mocka secrets (app_secret/HMAC), dedup (sempre primeira vez) e publisher (sem
 * RabbitMQ). É puro: roda sem infra.
 */
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APP_SECRET = 'coex_test_secret';

const publishInboundMessage = vi.fn((_payload: unknown): Promise<boolean> => Promise.resolve(true));
const publishCoexistenceEcho = vi.fn((_payload: unknown): Promise<boolean> => Promise.resolve(true));
const publishHistoryBatch = vi.fn((_payload: unknown): Promise<boolean> => Promise.resolve(true));
const publishAppState = vi.fn((_payload: unknown): Promise<boolean> => Promise.resolve(true));
const registerWebhookEvent = vi.fn((_input: unknown): Promise<boolean> => Promise.resolve(true));

vi.mock('../../secrets', () => ({
  platformSecrets: {
    get: (key: string) => (key === 'meta_app_secret' ? APP_SECRET : undefined),
    require: (key: string) => {
      if (key === 'meta_app_secret') return APP_SECRET;
      throw new Error(`missing ${key}`);
    },
  },
}));

vi.mock('./dedup', () => ({
  registerWebhookEvent,
}));

vi.mock('./publisher', () => ({
  publishInboundMessage,
  publishCoexistenceEcho,
  publishHistoryBatch,
  publishAppState,
}));

// Submissions de flow (não relevante aqui) — stub para evitar DB.
vi.mock('../flows/submissions', () => ({
  createSubmissionDeps: () => ({}),
  processMetaFlowSubmission: async () => undefined,
}));

const { createMetaWebhookRouter } = await import('./meta');

function app() {
  const a = express();
  a.use(createMetaWebhookRouter());
  return a;
}

function sign(raw: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(Buffer.from(raw, 'utf8')).digest('hex')}`;
}

async function post(body: Record<string, unknown>): Promise<number> {
  const raw = JSON.stringify(body);
  const res = await request(app())
    .post('/webhooks/meta')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', sign(raw))
    .send(raw);
  return res.status;
}

const PHONE_ID = '109876543210987';
const metadata = { metadata: { phone_number_id: PHONE_ID } };

function wabaChange(field: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field, value: { ...metadata, ...value } }] }],
  };
}

describe('POST /webhooks/meta — coexistência', () => {
  beforeEach(() => {
    registerWebhookEvent.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('publica coexistence.echo para smb_message_echoes', async () => {
    const status = await post(
      wabaChange('smb_message_echoes', {
        message_echoes: [{ id: 'wamid.E1', to: '5511999999999', type: 'text', text: { body: 'hi' } }],
      }),
    );
    expect(status).toBe(200);
    expect(publishCoexistenceEcho).toHaveBeenCalledTimes(1);
    expect(publishCoexistenceEcho).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: PHONE_ID, externalId: 'wamid.E1', to: '5511999999999' }),
    );
    expect(publishHistoryBatch).not.toHaveBeenCalled();
    expect(publishAppState).not.toHaveBeenCalled();
  });

  it('publica coexistence.history para history', async () => {
    const status = await post(
      wabaChange('history', {
        history: { contacts: [{ wa_id: '5511777' }], messages: [{ id: 'wamid.H1', type: 'text' }] },
      }),
    );
    expect(status).toBe(200);
    expect(publishHistoryBatch).toHaveBeenCalledTimes(1);
    expect(publishHistoryBatch).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: PHONE_ID }),
    );
  });

  it('publica coexistence.app_state para smb_app_state_sync', async () => {
    const status = await post(
      wabaChange('smb_app_state_sync', { smb_app_state_sync: { state: 'CONNECTED' } }),
    );
    expect(status).toBe(200);
    expect(publishAppState).toHaveBeenCalledTimes(1);
    expect(publishAppState).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: PHONE_ID, state: 'CONNECTED' }),
    );
  });

  it('messages inbound NÃO dispara publish de coexistência (ack 200)', async () => {
    const status = await post(
      wabaChange('messages', {
        messages: [{ from: '5511999', id: 'wamid.IN', timestamp: '1700000000', type: 'text', text: { body: 'oi' } }],
      }),
    );
    expect(status).toBe(200);
    expect(publishInboundMessage).toHaveBeenCalledTimes(1);
    expect(publishCoexistenceEcho).not.toHaveBeenCalled();
    expect(publishHistoryBatch).not.toHaveBeenCalled();
    expect(publishAppState).not.toHaveBeenCalled();
  });

  it('campo desconhecido → ack 200 sem publicar coexistência', async () => {
    const status = await post(wabaChange('account_alerts', { foo: 'bar' }));
    expect(status).toBe(200);
    expect(publishCoexistenceEcho).not.toHaveBeenCalled();
    expect(publishHistoryBatch).not.toHaveBeenCalled();
    expect(publishAppState).not.toHaveBeenCalled();
  });

  it('duplicata (dedup=false) não re-publica', async () => {
    registerWebhookEvent.mockResolvedValue(false);
    const status = await post(
      wabaChange('smb_message_echoes', {
        message_echoes: [{ id: 'wamid.E1', to: '5511999999999', type: 'text' }],
      }),
    );
    expect(status).toBe(200);
    expect(publishCoexistenceEcho).not.toHaveBeenCalled();
  });
});
