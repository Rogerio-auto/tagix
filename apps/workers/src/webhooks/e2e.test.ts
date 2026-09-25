/**
 * F70-S09 — webhooks de saída de ponta a ponta, com a infra real de dev:
 *
 *   emitDomainEvent (produtor real) → RabbitMQ hm.events (rk domain.<evento>)
 *     → hm.q.webhooks → consumer (startWebhookFanoutWorker) → fanoutEvent (Postgres)
 *     → dispatchPending (ssrfSafeFetch real) → receptor HTTP local
 *
 * O receptor verifica `x-hm-signature-256` como um cliente de verdade: HMAC-SHA256
 * do CORPO CRU com o segredo do endpoint, comparação em tempo constante. Cobre:
 *   - entrega de evento real assinado (message.received, conversation.handoff);
 *   - retentativa HTTP: 500 → `retrying` → 200 → `sent`, mesma assinatura;
 *   - dedup: o mesmo evento publicado duas vezes vira UMA entrega;
 *   - retentativa na fila: fan-out que falha volta pela wait-queue e entrega.
 *
 * Requer Postgres/RabbitMQ de dev (`infra/docker/docker-compose.dev.yml`) e o .env
 * da raiz. O receptor escuta em 127.0.0.1, liberado só aqui pela allowlist do
 * operador (`HM_WEBHOOK_HTTP_ALLOWLIST`), como em self-hosted.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

beforeAll(() => {
  process.env['HM_WEBHOOK_HTTP_ALLOWLIST'] = '127.0.0.1';
  if (process.env['DATABASE_URL'] && process.env['ENCRYPTION_KEY'] && process.env['AMQP_URL']) {
    return;
  }
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
    // Sem .env → getDb()/connectMq lançam com mensagem clara.
  }
});

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, encryptSecret, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import {
  assertTopology,
  closeDomainEventEmitter,
  connectMq,
  domainEvents,
  emitDomainEvent,
  type DomainEventDraft,
} from '@hm/shared/mq';
import {
  dispatchPending,
  fanoutEvent,
  SIGNATURE_HEADER,
  startWebhookFanoutWorker,
  type WebhookEvent,
  type WebhookFanoutWorkerHandle,
} from './index';

const { workspaces, outboundWebhooks, outboundWebhookDeliveries } = schema;
const logger = createLogger('error');
const SECRET = `e2e-secret-${randomUUID()}`;

// ─── Receptor HTTP de teste (verifica como um cliente real) ───────────────────

interface Received {
  readonly event: string | undefined;
  readonly signatureValid: boolean;
  readonly body: Record<string, unknown>;
}

const received: Received[] = [];
/** Status a responder, em ordem; vazio = 200. */
const plannedStatuses: number[] = [];

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Verificação do lado do cliente: HMAC do corpo cru + comparação em tempo constante. */
function verifySignature(raw: Buffer, header: string | undefined): boolean {
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`,
    'utf8',
  );
  const got = Buffer.from(header ?? '', 'utf8');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

let server: Server;
let hookUrl = '';

function startReceiver(): Promise<void> {
  server = createServer((req, res) => {
    void (async () => {
      const raw = await readRaw(req);
      const sigHeader = req.headers[SIGNATURE_HEADER];
      const eventHeader = req.headers['x-hm-event'];
      received.push({
        event: typeof eventHeader === 'string' ? eventHeader : undefined,
        signatureValid: verifySignature(raw, typeof sigHeader === 'string' ? sigHeader : undefined),
        body: JSON.parse(raw.toString('utf8')) as Record<string, unknown>,
      });
      res.statusCode = plannedStatuses.shift() ?? 200;
      res.end(res.statusCode >= 400 ? 'boom' : 'ok');
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      hookUrl = `http://127.0.0.1:${port}/hook`;
      resolve();
    });
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let ws = '';
let webhookId = '';
let worker: WebhookFanoutWorkerHandle | null = null;
/** eventIds cujo 1º fan-out deve falhar (exercita o retry da fila). */
const failOnceEventIds = new Set<string>();
let fanoutCalls = 0;

async function deliveries() {
  return getDb()
    .select()
    .from(outboundWebhookDeliveries)
    .where(eq(outboundWebhookDeliveries.webhookId, webhookId));
}

async function waitFor<T>(
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function deliveriesOf(eventId: string) {
  return async () =>
    (await deliveries()).filter(
      (d) => (d.payload['_meta'] as { eventId?: string } | undefined)?.eventId === eventId,
    );
}

/** Deixa as entregas deste workspace vencidas agora (pula o backoff real). */
async function makeDue(): Promise<void> {
  await getDb().execute(sql`
    UPDATE outbound_webhook_deliveries SET next_attempt_at = now() - interval '1 second'
    WHERE workspace_id = ${ws}::uuid AND status IN ('pending', 'retrying')
  `);
}

beforeAll(async () => {
  await startReceiver();

  const [w] = await getDb()
    .insert(workspaces)
    .values({ name: 'WH e2e', slug: `wh-e2e-${randomUUID().slice(0, 8)}` })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;

  const [hook] = await getDb()
    .insert(outboundWebhooks)
    .values({
      workspaceId: ws,
      name: 'Rogério OS (teste)',
      url: hookUrl,
      events: ['message.received', 'conversation.handoff', 'deal.won'],
      isActive: true,
      secretEnc: encryptSecret(SECRET),
    })
    .returning({ id: outboundWebhooks.id });
  if (!hook) throw new Error('webhook');
  webhookId = hook.id;

  // Topologia real (idempotente): cria hm.q.webhooks + bind domain.# + retry ladder.
  const boot = await connectMq();
  await assertTopology(boot.channel);
  await boot.connection.close();

  worker = await startWebhookFanoutWorker({
    logger,
    fanout: async (evt: WebhookEvent) => {
      if (evt.workspaceId === ws) fanoutCalls += 1;
      if (failOnceEventIds.delete(evt.eventId)) throw new Error('db indisponível (simulado)');
      return fanoutEvent(evt);
    },
  });
});

afterAll(async () => {
  await worker?.stop();
  await closeDomainEventEmitter();
  if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function messageReceived(): DomainEventDraft {
  return domainEvents.messageReceived(ws, {
    conversationId: randomUUID(),
    messageId: randomUUID(),
    contactId: randomUUID(),
    channelId: randomUUID(),
    type: 'text',
    text: 'Oi, quero agendar',
  });
}

describe('webhooks de saída — ponta a ponta (F70-S09)', () => {
  it('evento real chega assinado; 500 retenta e a próxima tentativa entrega', async () => {
    const draft = messageReceived();
    received.length = 0;
    plannedStatuses.push(500); // 1ª tentativa falha no cliente

    expect(await emitDomainEvent(draft)).toBe(true);

    const rows = await waitFor(deliveriesOf(draft.eventId), (r) => r.length === 1, 10_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event).toBe('message.received');

    // 1ª tentativa: cliente responde 500 → retrying, com backoff agendado.
    const first = await dispatchPending({ logger, workspaceId: ws });
    expect(first.retried).toBe(1);
    const [afterFail] = await deliveriesOf(draft.eventId)();
    expect(afterFail?.status).toBe('retrying');
    expect(afterFail?.responseStatus).toBe(500);
    expect(afterFail?.attempt).toBe(1);
    expect(afterFail?.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());

    // 2ª tentativa (backoff vencido): 200 → sent.
    await makeDue();
    const second = await dispatchPending({ logger, workspaceId: ws });
    expect(second.sent).toBe(1);
    const [afterOk] = await deliveriesOf(draft.eventId)();
    expect(afterOk?.status).toBe('sent');
    expect(afterOk?.attempt).toBe(2);

    // O receptor viu as DUAS tentativas, ambas com assinatura válida e o mesmo corpo.
    expect(received).toHaveLength(2);
    for (const r of received) {
      expect(r.signatureValid).toBe(true);
      expect(r.event).toBe('message.received');
      expect(r.body['messageId']).toBe((draft.data as { messageId: string }).messageId);
      expect(r.body['text']).toBe('Oi, quero agendar');
      expect(r.body['_meta']).toEqual({
        eventId: draft.eventId,
        event: 'message.received',
        occurredAt: draft.occurredAt,
      });
    }
  });

  it('o mesmo evento publicado duas vezes vira UMA entrega (dedup por eventId)', async () => {
    const draft = messageReceived();
    received.length = 0;

    expect(await emitDomainEvent(draft)).toBe(true);
    expect(await emitDomainEvent(draft)).toBe(true); // republicação (retry do produtor)

    // Espera o consumer processar as duas cópias: a 2ª é deduplicada.
    const callsBefore = fanoutCalls;
    await waitFor(async () => fanoutCalls, (n) => n >= callsBefore + 2, 10_000);
    const rows = await waitFor(deliveriesOf(draft.eventId), (r) => r.length >= 1, 10_000);
    expect(rows).toHaveLength(1);

    const tick = await dispatchPending({ logger, workspaceId: ws });
    expect(tick.sent).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]?.signatureValid).toBe(true);
  });

  it('fan-out concorrente do mesmo evento não duplica (advisory lock)', async () => {
    const draft = messageReceived();
    const evt: WebhookEvent = {
      workspaceId: ws,
      event: draft.event,
      eventId: draft.eventId,
      data: draft.data,
    };
    const results = await Promise.all([fanoutEvent(evt), fanoutEvent(evt), fanoutEvent(evt)]);
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.deduped, 0)).toBe(2);
    expect(await deliveriesOf(draft.eventId)()).toHaveLength(1);
    await dispatchPending({ logger, workspaceId: ws }); // drena p/ não vazar p/ o próximo teste
  });

  it('conversation.handoff chega com o payload mínimo (sem o motivo escrito pela IA)', async () => {
    const conversationId = randomUUID();
    const agentId = randomUUID();
    const draft = domainEvents.conversationHandoff(
      ws,
      { conversationId, agentId, departmentId: null },
      randomUUID(),
    );
    received.length = 0;

    expect(await emitDomainEvent(draft)).toBe(true);
    await waitFor(deliveriesOf(draft.eventId), (r) => r.length === 1, 10_000);
    await dispatchPending({ logger, workspaceId: ws });

    expect(received).toHaveLength(1);
    const got = received[0];
    expect(got?.signatureValid).toBe(true);
    expect(got?.event).toBe('conversation.handoff');
    expect(Object.keys(got?.body ?? {}).sort()).toEqual(
      ['_meta', 'agentId', 'conversationId', 'departmentId'].sort(),
    );
  });

  it('evento não assinado pelo endpoint não gera entrega', async () => {
    const draft = domainEvents.dealCreated(ws, {
      dealId: randomUUID(),
      pipelineId: randomUUID(),
      stageId: randomUUID(),
      contactId: randomUUID(),
      conversationId: null,
      valueCents: 0,
      currency: 'BRL',
    });
    const callsBefore = fanoutCalls;
    expect(await emitDomainEvent(draft)).toBe(true);
    await waitFor(async () => fanoutCalls, (n) => n > callsBefore, 10_000);
    expect(await deliveriesOf(draft.eventId)()).toHaveLength(0);
  });

  it('fan-out que falha volta pela fila de retry e entrega depois', async () => {
    const draft = domainEvents.dealClosed(ws, true, new Date(), {
      dealId: randomUUID(),
      pipelineId: randomUUID(),
      stageId: randomUUID(),
      contactId: randomUUID(),
      valueCents: 150_000,
      currency: 'BRL',
    });
    failOnceEventIds.add(draft.eventId);
    received.length = 0;

    expect(await emitDomainEvent(draft)).toBe(true);
    // 1ª tentativa lança → wait-queue de 5s → volta à hm.q.webhooks → grava.
    const rows = await waitFor(deliveriesOf(draft.eventId), (r) => r.length === 1, 20_000);
    expect(failOnceEventIds.has(draft.eventId)).toBe(false); // a falha aconteceu
    expect(rows).toHaveLength(1);

    await dispatchPending({ logger, workspaceId: ws });
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe('deal.won');
    expect(received[0]?.signatureValid).toBe(true);
  }, 30_000);
});
