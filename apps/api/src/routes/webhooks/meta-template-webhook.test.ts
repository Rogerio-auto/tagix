import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const APP_SECRET = 'template_webhook_secret';
const order: string[] = [];
const processMetaTemplateStatusUpdates = vi.fn(async () => {
  order.push('template');
});
const publishInboundMessage = vi.fn(async () => {
  order.push('publish');
  return true;
});
const registerWebhookEvent = vi.fn(async () => {
  order.push('register');
  return true;
});

vi.mock('../../secrets', () => ({
  platformSecrets: { get: (key: string) => (key === 'meta_app_secret' ? APP_SECRET : undefined) },
}));
vi.mock('./meta-template-status', () => ({
  parseMetaTemplateStatusUpdates: () => [{ wabaId: 'waba-1', status: 'APPROVED' }],
  processMetaTemplateStatusUpdates,
}));
vi.mock('./dedup', () => ({
  hasWebhookEvent: async () => false,
  registerWebhookEvent,
  recordWebhookRedelivery: () => undefined,
}));
vi.mock('./publisher', () => ({
  publishInboundMessage,
  publishCoexistenceEcho: async () => true,
  publishHistoryBatch: async () => true,
  publishAppState: async () => true,
}));
vi.mock('../flows/submissions', () => ({
  createSubmissionDeps: () => ({}),
  processMetaFlowSubmission: async () => undefined,
}));

const { createMetaWebhookRouter } = await import('./meta');

const body = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'message_template_status_update',
          value: { event: 'APPROVED', message_template_id: 'meta-1' },
        },
      ],
    },
  ],
};

async function post() {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', APP_SECRET)
    .update(Buffer.from(raw, 'utf8'))
    .digest('hex')}`;
  const app = express();
  app.use(createMetaWebhookRouter());
  return request(app)
    .post('/webhooks/meta')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', signature)
    .send(raw);
}

describe('webhook de status de modelo + dedup', () => {
  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
    processMetaTemplateStatusUpdates.mockImplementation(async () => {
      order.push('template');
    });
  });

  it('persiste o status antes do publish e só então conclui o dedup', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(order).toEqual(['template', 'publish', 'register']);
  });

  it('falha de banco devolve 503 e não fecha o dedup', async () => {
    processMetaTemplateStatusUpdates.mockRejectedValueOnce(new Error('db down'));
    const response = await post();
    expect(response.status).toBe(503);
    expect(publishInboundMessage).not.toHaveBeenCalled();
    expect(registerWebhookEvent).not.toHaveBeenCalled();
  });
});
