/**
 * F9-S05 — worker de webhooks. Integração real contra o Postgres dev (fan-out +
 * estado das deliveries) com o dispatch HTTP MOCKADO (fetch injetado) — o POST real
 * exige URL de cliente externa, então validamos a lógica: assinatura HMAC no header,
 * sucesso → sent, falha → retry exponencial → failed, e idempotência do fan-out.
 *
 * `@hm/workers` não tem dotenv; carregamos DATABASE_URL/ENCRYPTION_KEY do .env da raiz
 * com um parser mínimo (mesmo padrão do teste de dashboard-refresh).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHmac } from 'node:crypto';

beforeAll(() => {
  if (process.env['DATABASE_URL'] && process.env['ENCRYPTION_KEY']) return;
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env');
  try {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // Sem .env → getDb()/encryptSecret lançam com mensagem clara.
  }
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, encryptSecret, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import { backoffSeconds, dispatchPending, fanoutEvent, MAX_ATTEMPTS, signWebhook } from './index';

const { workspaces, outboundWebhooks, outboundWebhookDeliveries } = schema;
const logger = createLogger('error');

let ws = '';

async function mkWebhook(opts: {
  events: string[];
  secret?: string;
  isActive?: boolean;
  url?: string;
}): Promise<{ id: string; secret: string }> {
  const secret = opts.secret ?? 'super-secret-key-1234567890';
  const [row] = await getDb()
    .insert(outboundWebhooks)
    .values({
      workspaceId: ws,
      name: `wh-${randomUUID().slice(0, 6)}`,
      url: opts.url ?? 'https://example.test/hook',
      events: opts.events,
      isActive: opts.isActive ?? true,
      secretEnc: encryptSecret(secret),
    })
    .returning({ id: outboundWebhooks.id });
  if (!row) throw new Error('webhook');
  return { id: row.id, secret };
}

async function deliveriesFor(webhookId: string) {
  return getDb()
    .select()
    .from(outboundWebhookDeliveries)
    .where(eq(outboundWebhookDeliveries.webhookId, webhookId));
}

beforeAll(async () => {
  const [w] = await getDb()
    .insert(workspaces)
    .values({ name: 'WH', slug: `wh-${randomUUID().slice(0, 8)}` })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;
});

afterAll(async () => {
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('signWebhook / backoff', () => {
  it('assina HMAC-SHA256 prefixado e determinístico', () => {
    const sig = signWebhook('k', '{"a":1}');
    expect(sig).toBe(`sha256=${createHmac('sha256', 'k').update('{"a":1}').digest('hex')}`);
  });
  it('backoff cresce exponencialmente com teto', () => {
    expect(backoffSeconds(0)).toBe(5);
    expect(backoffSeconds(1)).toBe(10);
    expect(backoffSeconds(2)).toBe(20);
    expect(backoffSeconds(100)).toBe(3600); // teto
  });
});

describe('fanoutEvent', () => {
  it('cria delivery só para webhooks ativos que assinam o evento', async () => {
    const subscriber = await mkWebhook({ events: ['message.sent', 'deal.won'] });
    const other = await mkWebhook({ events: ['message.received'] }); // não assina
    const inactive = await mkWebhook({ events: ['message.sent'], isActive: false });

    const res = await fanoutEvent({
      workspaceId: ws,
      event: 'message.sent',
      eventId: `${randomUUID()}:sent`,
      data: { messageId: 'm1' },
    });
    expect(res.matchedWebhooks).toBe(1);
    expect(res.created).toBe(1);

    expect(await deliveriesFor(subscriber.id)).toHaveLength(1);
    expect(await deliveriesFor(other.id)).toHaveLength(0);
    expect(await deliveriesFor(inactive.id)).toHaveLength(0);
  });

  it('é idempotente por (webhook, eventId) — replay não duplica', async () => {
    const wh = await mkWebhook({ events: ['deal.stage_changed'] });
    const eventId = `${randomUUID()}:stage`;
    const first = await fanoutEvent({ workspaceId: ws, event: 'deal.stage_changed', eventId, data: {} });
    const second = await fanoutEvent({ workspaceId: ws, event: 'deal.stage_changed', eventId, data: {} });
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.deduped).toBe(1);
    expect(await deliveriesFor(wh.id)).toHaveLength(1);
  });

  it('embute _meta.eventId/event no payload', async () => {
    const wh = await mkWebhook({ events: ['conversion.registered'] });
    const eventId = `${randomUUID()}:conv`;
    await fanoutEvent({ workspaceId: ws, event: 'conversion.registered', eventId, data: { value: 10 } });
    const [d] = await deliveriesFor(wh.id);
    const payload = d?.payload as { value: number; _meta: { eventId: string; event: string } };
    expect(payload.value).toBe(10);
    expect(payload._meta.eventId).toBe(eventId);
    expect(payload._meta.event).toBe('conversion.registered');
  });
});

describe('dispatchPending', () => {
  it('sucesso (2xx) → sent, com header de assinatura HMAC correto', async () => {
    const secret = 'sign-me-please-0987654321';
    const wh = await mkWebhook({ events: ['message.sent'], secret });
    await fanoutEvent({ workspaceId: ws, event: 'message.sent', eventId: `${randomUUID()}:s`, data: { x: 1 } });

    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      // Verifica a assinatura sobre o corpo exato.
      const body = init.body as string;
      const expected = signWebhook(secret, body);
      expect((init.headers as Record<string, string>)['x-hm-signature-256']).toBe(expected);
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await dispatchPending({ logger, fetchImpl });
    expect(res.sent).toBeGreaterThanOrEqual(1);
    const [d] = await deliveriesFor(wh.id);
    expect(d?.status).toBe('sent');
    expect(d?.responseStatus).toBe(200);
    expect(d?.sentAt).not.toBeNull();
  });

  it('falha → retrying com next_attempt_at futuro e attempt incrementado', async () => {
    const wh = await mkWebhook({ events: ['deal.won'] });
    await fanoutEvent({ workspaceId: ws, event: 'deal.won', eventId: `${randomUUID()}:w`, data: {} });

    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const now = new Date();
    const res = await dispatchPending({ logger, fetchImpl, now: () => now });
    expect(res.retried).toBeGreaterThanOrEqual(1);
    const [d] = await deliveriesFor(wh.id);
    expect(d?.status).toBe('retrying');
    expect(d?.attempt).toBe(1);
    expect(d?.nextAttemptAt).not.toBeNull();
    expect(new Date(d!.nextAttemptAt!).getTime()).toBeGreaterThan(now.getTime());
  });

  it('esgota tentativas → failed', async () => {
    const wh = await mkWebhook({ events: ['message.received'] });
    await fanoutEvent({ workspaceId: ws, event: 'message.received', eventId: `${randomUUID()}:r`, data: {} });
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    // Cada tick processa a entrega uma vez; força next_attempt_at p/ o passado entre ticks.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await dispatchPending({ logger, fetchImpl });
      await getDb()
        .update(outboundWebhookDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(outboundWebhookDeliveries.webhookId, wh.id));
    }
    const [d] = await deliveriesFor(wh.id);
    expect(d?.status).toBe('failed');
    expect(d?.attempt).toBe(MAX_ATTEMPTS);
  });
});
