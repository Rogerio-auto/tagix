/**
 * F52-S02 — Webhook à prova de perda de evento.
 *
 * Prova o contrato crítico: o dedup (`webhook_events`) só é marcado APÓS o
 * enqueue confirmado. Se o publish lança OU aplica backpressure (`false`), a
 * borda responde 5xx (o provider reentrega) e NÃO marca o dedup — nada se perde.
 * Reentrega de evento já visto → 200 sem republicar + contador de reentrega.
 *
 * Puro: secrets, dedup e publisher são mockados; roda sem RabbitMQ/Postgres.
 */
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APP_SECRET = 'loss_test_app_secret';
const WAHA_SECRET = 'loss_test_waha_secret';

const publishInboundMessage = vi.fn((_payload: unknown): Promise<boolean> => Promise.resolve(true));
const publishCoexistenceEcho = vi.fn((_payload: unknown): Promise<boolean> => Promise.resolve(true));
const publishHistoryBatch = vi.fn((_payload: unknown): Promise<boolean> => Promise.resolve(true));
const publishAppState = vi.fn((_payload: unknown): Promise<boolean> => Promise.resolve(true));

const registerWebhookEvent = vi.fn((_input: unknown): Promise<boolean> => Promise.resolve(true));
const hasWebhookEvent = vi.fn((_input: unknown): Promise<boolean> => Promise.resolve(false));
const recordWebhookRedelivery = vi.fn((_provider: unknown): void => undefined);

vi.mock('../../secrets', () => ({
  platformSecrets: {
    get: (key: string) => {
      if (key === 'meta_app_secret') return APP_SECRET;
      if (key === 'waha_webhook_secret') return WAHA_SECRET;
      return undefined;
    },
    require: (key: string) => {
      if (key === 'meta_app_secret') return APP_SECRET;
      if (key === 'waha_webhook_secret') return WAHA_SECRET;
      throw new Error(`missing ${key}`);
    },
  },
}));

vi.mock('./dedup', () => ({
  registerWebhookEvent,
  hasWebhookEvent,
  recordWebhookRedelivery,
}));

vi.mock('./publisher', () => ({
  publishInboundMessage,
  publishCoexistenceEcho,
  publishHistoryBatch,
  publishAppState,
}));

// Submissions de flow (irrelevantes aqui) — stub para evitar DB no module load.
vi.mock('../flows/submissions', () => ({
  createSubmissionDeps: () => ({}),
  processMetaFlowSubmission: async () => undefined,
}));

const { createMetaWebhookRouter } = await import('./meta');
const { createWahaWebhookRouter } = await import('./waha');

function metaApp(): Express {
  const a = express();
  a.use(createMetaWebhookRouter());
  return a;
}

function wahaApp(): Express {
  const a = express();
  a.use(createWahaWebhookRouter());
  return a;
}

function signMeta(raw: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(Buffer.from(raw, 'utf8')).digest('hex')}`;
}

const metaBody = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '109876543210987' },
            messages: [
              { from: '5511999', id: 'wamid.LOSS1', timestamp: '1700000000', type: 'text', text: { body: 'oi' } },
            ],
          },
        },
      ],
    },
  ],
};

async function postMeta(): Promise<number> {
  const raw = JSON.stringify(metaBody);
  const res = await request(metaApp())
    .post('/webhooks/meta')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', signMeta(raw))
    .send(raw);
  return res.status;
}

async function postWaha(): Promise<number> {
  const raw = JSON.stringify({ event: 'message', payload: { id: 'waha.LOSS1', body: 'oi' } });
  const res = await request(wahaApp())
    .post('/webhooks/waha')
    .set('content-type', 'application/json')
    .set('x-api-key', WAHA_SECRET)
    .send(raw);
  return res.status;
}

beforeEach(() => {
  registerWebhookEvent.mockResolvedValue(true);
  hasWebhookEvent.mockResolvedValue(false);
  publishInboundMessage.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /webhooks/meta — à prova de perda (F52-S02)', () => {
  it('caminho feliz: assinatura válida + publish ok → 200 + dedup marcado + 1 publish', async () => {
    expect(await postMeta()).toBe(200);
    expect(publishInboundMessage).toHaveBeenCalledTimes(1);
    expect(registerWebhookEvent).toHaveBeenCalledTimes(1);
    expect(recordWebhookRedelivery).not.toHaveBeenCalled();
  });

  it('publish que LANÇA → 5xx e dedup NÃO marcado (reentrega possível)', async () => {
    publishInboundMessage.mockRejectedValueOnce(new Error('broker indisponível'));
    expect(await postMeta()).toBe(503);
    expect(registerWebhookEvent).not.toHaveBeenCalled();
  });

  it('publish com backpressure (false) → 5xx e dedup NÃO marcado', async () => {
    publishInboundMessage.mockResolvedValueOnce(false);
    expect(await postMeta()).toBe(503);
    expect(registerWebhookEvent).not.toHaveBeenCalled();
  });

  it('reentrega (evento já visto) → 200 sem republicar + contador incrementa', async () => {
    hasWebhookEvent.mockResolvedValueOnce(true);
    expect(await postMeta()).toBe(200);
    expect(publishInboundMessage).not.toHaveBeenCalled();
    expect(registerWebhookEvent).not.toHaveBeenCalled();
    expect(recordWebhookRedelivery).toHaveBeenCalledWith('meta_whatsapp');
  });

  it('marca o dedup SOMENTE após o enqueue (ordem)', async () => {
    const order: string[] = [];
    publishInboundMessage.mockImplementationOnce(async () => {
      order.push('publish');
      return true;
    });
    registerWebhookEvent.mockImplementationOnce(async () => {
      order.push('register');
      return true;
    });
    await postMeta();
    expect(order).toEqual(['publish', 'register']);
  });
});

describe('POST /webhooks/waha — à prova de perda (F52-S02)', () => {
  it('caminho feliz: key válida + publish ok → 200 + dedup marcado + 1 publish', async () => {
    expect(await postWaha()).toBe(200);
    expect(publishInboundMessage).toHaveBeenCalledTimes(1);
    expect(registerWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('publish que LANÇA → 5xx e dedup NÃO marcado', async () => {
    publishInboundMessage.mockRejectedValueOnce(new Error('broker indisponível'));
    expect(await postWaha()).toBe(503);
    expect(registerWebhookEvent).not.toHaveBeenCalled();
  });

  it('publish com backpressure (false) → 5xx e dedup NÃO marcado', async () => {
    publishInboundMessage.mockResolvedValueOnce(false);
    expect(await postWaha()).toBe(503);
    expect(registerWebhookEvent).not.toHaveBeenCalled();
  });

  it('reentrega (evento já visto) → 200 sem republicar + contador incrementa', async () => {
    hasWebhookEvent.mockResolvedValueOnce(true);
    expect(await postWaha()).toBe(200);
    expect(publishInboundMessage).not.toHaveBeenCalled();
    expect(registerWebhookEvent).not.toHaveBeenCalled();
    expect(recordWebhookRedelivery).toHaveBeenCalledWith('waha');
  });
});
