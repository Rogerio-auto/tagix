/**
 * F70-S16 — outbox transacional + relay, contra o Postgres e o RabbitMQ de dev.
 *
 * Definition of Done:
 *  - rollback → nada na outbox e nada publicado;
 *  - processo "cai" depois do commit (relay parado) → ao voltar, o evento é publicado;
 *  - broker fora → tentativas com backoff, depois entrega (queda de conexão não gasta
 *    tentativa de mensagem; mensagem recusada ganha backoff e, no teto, `dead`);
 *  - dois relays em paralelo → cada mensagem publicada uma vez;
 *  - LISTEN/NOTIFY acorda o relay sem esperar o polling; limpeza pelos índices.
 * Mais a fronteira de segurança: hm_app só grava (no próprio workspace) e não lê.
 *
 * Cada relay aqui drena SÓ o workspace do teste (`workspaceId`), para não levar ao
 * broker as linhas de outros testes que rodam em paralelo no mesmo banco. O evento de
 * domínio vai ao exchange real `hm.events` e é observado por uma fila privada ligada em
 * `domain.#`.
 *
 * Jobs: desde a F70-S24 o banco só aceita job nas filas de `OUTBOX_JOB_QUEUES`. A linha
 * é gravada como job real de `hm.q.media` (passa pelos CHECKs e pela checagem do relay)
 * e o publisher do teste ({@link redirect}) desvia, só no broker, para a fila privada
 * (`hm.test.outbox.*`) indicada no payload — o teste observa sem tocar a fila real.
 *
 * Pula sem `DATABASE_URL`/`AMQP_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, enqueueOutbox, getDb, purgeOutbox, schema, withWorkspace } from '@hm/db';
import type { Logger } from '@hm/logger';
import {
  assertTopology,
  connectMq,
  domainEventOutbox,
  domainEvents,
  EXCHANGES,
  makeEnvelope,
  openConfirmPublisher,
  queueJobOutbox,
  QUEUES,
  type ConfirmPublisher,
  type Envelope,
  type MqHandle,
  type OutboxMessage,
} from '@hm/shared/mq';
import { OutboxRelay, backoffDelayMs, type OutboxRelayOptions } from './relay';
import { outboxRowsOf } from './testing';

const ready = Boolean(process.env['DATABASE_URL'] && process.env['AMQP_URL']);

function makeLogger() {
  const fns = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const logger = { ...fns, child: () => logger } as unknown as Logger;
  return { logger, ...fns };
}

async function waitFor<T>(
  probe: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fila real em que as linhas de job do teste são gravadas (aceita pelo CHECK da 0091). */
const TEST_ROUTE_QUEUE = QUEUES.media;

/** Fila privada que o job do teste carrega no payload (`testQueue`), ou `null`. */
function testQueueOf(envelope: Envelope): string | null {
  const payload = envelope.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const q: unknown = (payload as Record<string, unknown>)['testQueue'];
  return typeof q === 'string' ? q : null;
}

/**
 * Publisher que desvia, no broker, o job do teste para a fila privada dele. O relay
 * confere a linha real (`hm.q.media`) antes; o desvio acontece depois, na publicação.
 */
function redirect(inner: ConfirmPublisher): ConfirmPublisher {
  return {
    publishBatch: (items) =>
      inner.publishBatch(
        items.map((item) => {
          const q = item.exchange === '' ? testQueueOf(item.envelope) : null;
          return q === null ? item : { ...item, routingKey: q };
        }),
      ),
    isOpen: () => inner.isOpen(),
    close: () => inner.close(),
  };
}

/** Mensagem do Postgres por trás do erro do Drizzle (`Failed query: …` embrulha a causa). */
async function pgFailure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (err: unknown) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'não falhou';
}

describe.skipIf(!ready)('F70-S16 outbox transacional + relay', { timeout: 30_000 }, () => {
  const sfx = randomUUID().slice(0, 8);
  let workspaceId = '';
  let otherWorkspaceId = '';
  let mq: MqHandle;
  /** Mensagens recebidas por fila privada, na ordem. */
  const received = new Map<string, Envelope[]>();
  const relays: OutboxRelay[] = [];

  const queueName = (tag: string) => `hm.test.outbox.${sfx}.${tag}`;

  async function listenQueue(
    name: string,
    opts: { bindDomainEvents?: boolean } = {},
  ): Promise<void> {
    await mq.channel.assertQueue(name, { durable: false, autoDelete: true });
    if (opts.bindDomainEvents) await mq.channel.bindQueue(name, EXCHANGES.events, 'domain.#');
    received.set(name, []);
    await mq.channel.consume(name, (msg) => {
      if (!msg) return;
      received.get(name)?.push(JSON.parse(msg.content.toString('utf8')) as Envelope);
      mq.channel.ack(msg);
    });
  }
  const got = (name: string) => received.get(name) ?? [];

  /** Job gravado em `hm.q.media` e entregue (pelo {@link redirect}) na fila privada `queue`. */
  function testJob(queue: string, n: number): OutboxMessage {
    const envelope = makeEnvelope('test.outbox', workspaceId, { n, testQueue: queue });
    return queueJobOutbox(TEST_ROUTE_QUEUE, envelope);
  }

  async function commit(messages: readonly OutboxMessage[]): Promise<void> {
    await getDb().transaction(async (tx) => {
      await enqueueOutbox(tx, messages);
    });
  }

  function relay(opts: Partial<OutboxRelayOptions> = {}): {
    relay: OutboxRelay;
    log: ReturnType<typeof makeLogger>;
  } {
    const log = makeLogger();
    const { connectPublisher, ...rest } = opts;
    const connect = connectPublisher ?? (() => openConfirmPublisher());
    const r = new OutboxRelay({
      logger: log.logger,
      workspaceId,
      listen: false,
      pollIntervalMs: 50,
      cleanup: false,
      jitter: false,
      ...rest,
      connectPublisher: async () => redirect(await connect()),
    });
    relays.push(r);
    return { relay: r, log };
  }

  const rowsOf = async (ids: readonly string[]) =>
    (await outboxRowsOf(workspaceId)).filter((r) => ids.includes(r.eventId));

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S16 outbox', slug: `f70s16-${sfx}`, planId: null })
      .returning();
    const [other] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S16 outro', slug: `f70s16b-${sfx}`, planId: null })
      .returning();
    if (!ws || !other) throw new Error('workspaces não criados');
    workspaceId = ws.id;
    otherWorkspaceId = other.id;
    mq = await connectMq(undefined, { reconnect: false });
    await assertTopology(mq.channel);
  });

  afterEach(async () => {
    while (relays.length > 0) await relays.pop()?.stop();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, otherWorkspaceId));
    await mq.connection.close();
    await closeDb();
  });

  // ─── DoD 1 ────────────────────────────────────────────────────────────────────

  it('rollback → nada na outbox e nada publicado (papel de conexão e hm_app)', async () => {
    const q = queueName('rollback');
    await listenQueue(q);
    const a = testJob(q, 1);
    const b = domainEventOutbox(
      domainEvents.conversationOpened(workspaceId, {
        conversationId: randomUUID(),
        contactId: null,
        channelId: null,
        trigger: 'inbound',
      }),
    );

    await expect(
      getDb().transaction(async (tx) => {
        await enqueueOutbox(tx, [a]);
        throw new Error('rollback simulado');
      }),
    ).rejects.toThrow('rollback simulado');
    await expect(
      withWorkspace(workspaceId, async (tx) => {
        await enqueueOutbox(tx, [b]);
        throw new Error('rollback simulado');
      }),
    ).rejects.toThrow('rollback simulado');

    expect(await rowsOf([a.eventId, b.eventId])).toHaveLength(0);

    const { relay: r } = relay();
    await r.start();
    await waitFor(
      async () => r.getStats().publisherOpen,
      (v) => v,
    );
    await sleep(300);
    expect(got(q)).toHaveLength(0);
    expect(r.getStats().sent).toBe(0);
  });

  // ─── DoD 2 ────────────────────────────────────────────────────────────────────

  it('relay parado no commit ("processo caiu") → ao voltar publica evento e job, com confirms', async () => {
    const qJob = queueName('crash-job');
    const qEvt = queueName('crash-evt');
    await listenQueue(qJob);
    await listenQueue(qEvt, { bindDomainEvents: true });

    const conversationId = randomUUID();
    const evento = domainEventOutbox(
      domainEvents.conversationOpened(workspaceId, {
        conversationId,
        contactId: null,
        channelId: null,
        trigger: 'inbound',
      }),
    );
    const job = testJob(qJob, 2);
    // Grava pelo caminho real do produtor: withWorkspace (hm_app + RLS).
    await withWorkspace(workspaceId, (tx) => enqueueOutbox(tx, [evento, job]));

    // Nenhum relay no ar: tudo durável e pendente.
    await sleep(200);
    const pendentes = await rowsOf([evento.eventId, job.eventId]);
    expect(pendentes.map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(got(qJob)).toHaveLength(0);

    // "O processo volta": o relay sobe e entrega.
    const { relay: r } = relay();
    await r.start();
    const rows = await waitFor(
      () => rowsOf([evento.eventId, job.eventId]),
      (rs) => rs.every((x) => x.status === 'sent'),
    );
    expect(rows.map((x) => [x.status, x.attempts])).toEqual([
      ['sent', 1],
      ['sent', 1],
    ]);
    await waitFor(
      async () => got(qJob).length,
      (n) => n === 1,
    );
    expect(got(qJob)[0]).toEqual(job.envelope);
    const eventos = await waitFor(
      async () => got(qEvt).filter((e) => e.id === evento.envelope.id),
      (es) => es.length === 1,
    );
    expect(eventos[0]?.type).toBe('conversation.opened');
    expect(eventos[0]?.payload).toMatchObject({ eventId: `${conversationId}:opened` });
  });

  // ─── DoD 3 ────────────────────────────────────────────────────────────────────

  it('broker fora → reconecta com backoff sem gastar tentativa; depois entrega', async () => {
    const q = queueName('broker-down');
    await listenQueue(q);
    const msgs = [testJob(q, 1), testJob(q, 2), testJob(q, 3)];
    await commit(msgs);

    let tentativas = 0;
    const { relay: r, log } = relay({
      reconnectBackoff: { baseMs: 50, maxMs: 200 },
      connectPublisher: async () => {
        tentativas += 1;
        // Porta sem broker: conexão recusada, como um RabbitMQ fora do ar.
        if (tentativas <= 3) return openConfirmPublisher({ url: 'amqp://127.0.0.1:1' });
        return openConfirmPublisher();
      },
    });
    await r.start();

    // Enquanto o broker está fora, nenhuma linha é reivindicada.
    await waitFor(
      async () => tentativas,
      (n) => n >= 2,
      5_000,
    );
    const durante = await rowsOf(msgs.map((m) => m.eventId));
    expect(durante.every((x) => x.status === 'pending' && x.attempts === 0)).toBe(true);

    const rows = await waitFor(
      () => rowsOf(msgs.map((m) => m.eventId)),
      (rs) => rs.every((x) => x.status === 'sent'),
    );
    expect(tentativas).toBe(4);
    expect(rows.every((x) => x.attempts === 1)).toBe(true);
    await waitFor(
      async () => got(q).length,
      (n) => n === 3,
    );
    expect(got(q).map((e) => e.id)).toEqual(msgs.map((m) => m.envelope.id));
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('broker indisponível'),
      expect.objectContaining({ attempt: 1 }),
    );
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('broker indisponível'),
      expect.objectContaining({ attempt: 3 }),
    );
  });

  it('mensagem recusada (sem rota) → backoff exponencial por linha, depois entrega', async () => {
    const q = queueName('unroutable');
    const msg = testJob(q, 1); // a fila ainda não existe: basic.return
    await commit([msg]);

    const base = 300;
    const { relay: r, log } = relay({
      messageBackoff: { baseMs: base, maxMs: 5_000 },
      maxAttempts: 5,
    });
    await r.start();

    const primeira = await waitFor(
      () => rowsOf([msg.eventId]),
      (rs) => rs[0]?.attempts === 1,
    );
    expect(primeira[0]).toMatchObject({ status: 'pending', attempts: 1 });
    const detalhe = async () => {
      const [row] = Array.from(
        await getDb().execute(sql`
          SELECT last_error, extract(epoch FROM available_at - now()) * 1000 AS espera_ms
            FROM outbox WHERE event_id = ${msg.eventId}
        `),
      ) as Array<{ last_error: string | null; espera_ms: string | number }>;
      return row;
    };
    const d1 = await detalhe();
    expect(d1?.last_error).toMatch(/^unroutable/);
    expect(Number(d1?.espera_ms)).toBeGreaterThan(0);
    expect(Number(d1?.espera_ms)).toBeLessThanOrEqual(base);

    // Segunda recusa: o atraso dobra.
    const segunda = await waitFor(
      () => rowsOf([msg.eventId]),
      (rs) => rs[0]?.attempts === 2,
    );
    expect(segunda[0]?.status).toBe('pending');
    expect(backoffDelayMs(2, { baseMs: base, maxMs: 5_000 }, false)).toBe(2 * base);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('não confirmada'),
      expect.objectContaining({ attempt: 2, delayMs: 2 * base }),
    );

    // A rota aparece (a fila passa a existir): a próxima tentativa entrega.
    await listenQueue(q);
    const final = await waitFor(
      () => rowsOf([msg.eventId]),
      (rs) => rs[0]?.status === 'sent',
      10_000,
    );
    expect(final[0]?.status).toBe('sent');
    await waitFor(
      async () => got(q).length,
      (n) => n === 1,
    );
    expect(got(q)[0]?.id).toBe(msg.envelope.id);
  });

  it('esgotou as tentativas → dead, com log de erro, e não sai mais', async () => {
    const q = queueName('dead');
    const msg = testJob(q, 1);
    await commit([msg]);

    const { relay: r, log } = relay({ messageBackoff: { baseMs: 50, maxMs: 100 }, maxAttempts: 2 });
    await r.start();

    const rows = await waitFor(
      () => rowsOf([msg.eventId]),
      (rs) => rs[0]?.status === 'dead',
    );
    expect(rows[0]).toMatchObject({ status: 'dead', attempts: 2 });
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('MORTA'),
      expect.objectContaining({ eventId: msg.eventId, attempts: 2, routingKey: TEST_ROUTE_QUEUE }),
    );
    await sleep(300);
    expect((await rowsOf([msg.eventId]))[0]?.attempts).toBe(2);
  });

  // ─── DoD 4 ────────────────────────────────────────────────────────────────────

  it('dois relays em paralelo → cada mensagem publicada exatamente uma vez', async () => {
    const q = queueName('parallel');
    await listenQueue(q);
    const msgs = Array.from({ length: 300 }, (_, i) => testJob(q, i));
    await commit(msgs);

    const a = relay({ batchSize: 20, pollIntervalMs: 10 }).relay;
    const b = relay({ batchSize: 20, pollIntervalMs: 10 }).relay;
    await Promise.all([a.start(), b.start()]);

    const rows = await waitFor(
      () => rowsOf(msgs.map((m) => m.eventId)),
      (rs) => rs.length === 300 && rs.every((x) => x.status === 'sent'),
      20_000,
    );
    expect(rows.every((x) => x.status === 'sent' && x.attempts === 1)).toBe(true);
    await waitFor(
      async () => got(q).length,
      (n) => n >= 300,
      10_000,
    );
    await sleep(200);
    const ids = got(q).map((e) => e.id);
    expect(ids).toHaveLength(300);
    expect(new Set(ids).size).toBe(300);
    expect(a.getStats().sent + b.getStats().sent).toBe(300);
  }, 40_000);

  // ─── LISTEN/NOTIFY ─────────────────────────────────────────────────────────────

  it('NOTIFY no commit acorda o relay sem esperar o polling', async () => {
    const q = queueName('notify');
    await listenQueue(q);
    const { relay: r } = relay({ listen: true, pollIntervalMs: 60_000 });
    await r.start();
    expect(r.getStats().listening).toBe(true);
    // Deixa o relay conectar e dormir no polling longo.
    await waitFor(
      async () => r.getStats().publisherOpen,
      (v) => v,
    );
    await sleep(300);

    const msg = testJob(q, 1);
    const t0 = Date.now();
    await commit([msg]);
    await waitFor(
      async () => got(q).length,
      (n) => n === 1,
      5_000,
    );
    expect(got(q)).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  // ─── Limpeza ──────────────────────────────────────────────────────────────────

  it('limpeza apaga enviados e mortos antigos, mantém recentes e pendentes', async () => {
    const q = queueName('purge');
    const velhoEnviado = testJob(q, 1);
    const recenteEnviado = testJob(q, 2);
    const velhoMorto = testJob(q, 3);
    const pendente = testJob(q, 4);
    await commit([velhoEnviado, recenteEnviado, velhoMorto, pendente]);
    const db = getDb();
    await db.execute(sql`
      UPDATE outbox SET status = 'sent', sent_at = now() - interval '10 days'
       WHERE event_id = ${velhoEnviado.eventId}`);
    await db.execute(sql`
      UPDATE outbox SET status = 'sent', sent_at = now() - interval '1 day'
       WHERE event_id = ${recenteEnviado.eventId}`);
    await db.execute(sql`
      UPDATE outbox SET status = 'dead', created_at = now() - interval '40 days'
       WHERE event_id = ${velhoMorto.eventId}`);

    const purged = await purgeOutbox({ sentRetentionDays: 7, deadRetentionDays: 30 });
    expect(purged.sent).toBeGreaterThanOrEqual(1);
    expect(purged.dead).toBeGreaterThanOrEqual(1);
    const restantes = await rowsOf([
      velhoEnviado.eventId,
      recenteEnviado.eventId,
      velhoMorto.eventId,
      pendente.eventId,
    ]);
    expect(restantes.map((r) => r.eventId).sort()).toEqual(
      [recenteEnviado.eventId, pendente.eventId].sort(),
    );

    // A varredura usa o índice parcial de enviados (sem seq scan na tabela inteira).
    await db.execute(sql`SET enable_seqscan = off`);
    const plano = Array.from(
      await db.execute(sql`
        EXPLAIN SELECT id FROM outbox
         WHERE status = 'sent' AND sent_at < now() - interval '7 days'
         ORDER BY sent_at LIMIT 10`),
    )
      .map((r) => String((r as Record<string, unknown>)['QUERY PLAN']))
      .join('\n');
    await db.execute(sql`RESET enable_seqscan`);
    expect(plano).toContain('idx_outbox_sent_at');
  });

  // ─── Segurança ────────────────────────────────────────────────────────────────

  it('hm_app grava só no próprio workspace e não lê, não altera, não apaga', async () => {
    const proprio = domainEventOutbox(
      domainEvents.conversationOpened(workspaceId, {
        conversationId: randomUUID(),
        contactId: null,
        channelId: null,
        trigger: 'inbound',
      }),
    );
    const alheio = domainEventOutbox(
      domainEvents.conversationOpened(otherWorkspaceId, {
        conversationId: randomUUID(),
        contactId: null,
        channelId: null,
        trigger: 'inbound',
      }),
    );

    // Grava o próprio; regravar o mesmo event_id não duplica nem aborta a transação.
    const n = await withWorkspace(workspaceId, async (tx) => {
      const first = await enqueueOutbox(tx, proprio);
      const again = await enqueueOutbox(tx, proprio);
      return [first, again];
    });
    expect(n).toEqual([1, 0]);
    expect(await rowsOf([proprio.eventId])).toHaveLength(1);

    // Linha de outro workspace: a RLS recusa.
    expect(await pgFailure(withWorkspace(workspaceId, (tx) => enqueueOutbox(tx, alheio)))).toMatch(
      /row-level security/,
    );
    // Sem leitura do conteúdo, sem UPDATE, sem DELETE.
    expect(
      await pgFailure(
        withWorkspace(workspaceId, (tx) => tx.execute(sql`SELECT envelope FROM outbox LIMIT 1`)),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgFailure(
        withWorkspace(workspaceId, (tx) => tx.execute(sql`UPDATE outbox SET status = 'sent'`)),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgFailure(withWorkspace(workspaceId, (tx) => tx.execute(sql`DELETE FROM outbox`))),
    ).toMatch(/permission denied/);
    // F70-S24: nem o event_id. O ON CONFLICT sem alvo dispensa SELECT (0091).
    expect(
      await pgFailure(
        withWorkspace(otherWorkspaceId, (tx) => tx.execute(sql`SELECT event_id FROM outbox`)),
      ),
    ).toMatch(/permission denied/);
  });

  it('job de outbound pela outbox vai à fila hm.q.outbound pelo exchange padrão', () => {
    const env = makeEnvelope('outbound.request', workspaceId, { kind: 'text' });
    expect(queueJobOutbox(QUEUES.outbound, env)).toEqual({
      kind: 'job',
      eventId: env.id,
      exchange: '',
      routingKey: QUEUES.outbound,
      envelope: env,
    });
  });
});
