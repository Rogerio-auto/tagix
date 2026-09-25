/**
 * F70-S24 — a outbox confere envelope e destino contra o workspace (migração 0091).
 *
 * Definition of Done:
 *  - INSERT com `envelope.workspaceId` diferente da coluna → recusado pelo banco;
 *  - fila fora da lista → recusada pelo banco e pelo relay;
 *  - mesmo `event_id` em dois workspaces → aceito.
 * Mais: o CHECK de filas e `OUTBOX_JOB_QUEUES` são a mesma lista (lido do catálogo), o
 * conjunto de índices únicos que o ON CONFLICT sem alvo pressupõe, o hm_app só grava,
 * e o pré-voo da migração aborta com contagem.
 *
 * O relay aqui usa um publisher falso (sem broker): o que importa é o que ele se recusa
 * a entregar. Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeDb,
  DEFAULT_OUTBOX_DEAD_RETENTION_DAYS,
  DEFAULT_OUTBOX_SENT_RETENTION_DAYS,
  enqueueOutbox,
  getDb,
  schema,
  withWorkspace,
} from '@hm/db';
import type { Logger } from '@hm/logger';
import {
  domainEventOutbox,
  domainEvents,
  EXCHANGES,
  makeEnvelope,
  OUTBOX_EVENT_ROUTING_PREFIX,
  OUTBOX_JOB_QUEUES,
  outboxRowViolation,
  queueJobOutbox,
  QUEUES,
  type ConfirmPublisher,
  type ConfirmPublishItem,
  type OutboxMessage,
} from '@hm/shared/mq';
import { outboxRelayOptionsFromEnv } from './index';
import { OutboxRelay } from './relay';

const ready = Boolean(process.env['DATABASE_URL']);

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_0091 = path.resolve(
  here,
  '../../../../packages/db/drizzle/0091_f70_outbox_route_guard.sql',
);

function makeLogger() {
  const fns = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const logger = { ...fns, child: () => logger } as unknown as Logger;
  return { logger, ...fns };
}

interface PgFailure {
  readonly code: string;
  readonly constraint: string;
  readonly message: string;
  readonly detail: string;
}

/** Erro do Postgres por trás do erro do Drizzle (`Failed query: …` embrulha a causa). */
async function pgFailure(run: Promise<unknown>): Promise<PgFailure | null> {
  try {
    await run;
  } catch (err: unknown) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const rec: Record<string, unknown> =
      typeof cause === 'object' && cause !== null ? (cause as Record<string, unknown>) : {};
    return {
      code: String(rec['code'] ?? ''),
      constraint: String(rec['constraint_name'] ?? ''),
      message: cause instanceof Error ? cause.message : String(cause),
      detail: String(rec['detail'] ?? ''),
    };
  }
  return null;
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

/** Literal de texto SQL (os valores aqui são uuids e nomes de fila do próprio teste). */
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

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

// ─── Unidade: a checagem do relay (sem banco) ────────────────────────────────────

describe('outboxRowViolation (checagem do relay)', () => {
  const ws = randomUUID();
  const env = makeEnvelope('t', ws, {});

  it('aceita job nas filas de OUTBOX_JOB_QUEUES e evento domain.*', () => {
    for (const q of OUTBOX_JOB_QUEUES) {
      const m = queueJobOutbox(q, env);
      expect(outboxRowViolation({ ...m, workspaceId: ws })).toBeNull();
    }
    expect(
      outboxRowViolation({
        kind: 'event',
        workspaceId: ws,
        exchange: EXCHANGES.events,
        routingKey: 'domain.deal.created',
        envelope: env,
      }),
    ).toBeNull();
    // uuid em maiúsculas no envelope é o mesmo workspace (o CHECK compara em minúsculas).
    expect(
      outboxRowViolation({
        ...queueJobOutbox(QUEUES.media, env),
        workspaceId: ws,
        envelope: { ...env, workspaceId: ws.toUpperCase() },
      }),
    ).toBeNull();
  });

  it('recusa fila fora da lista, evento fora de domain.*, kind/exchange trocados e tenant trocado', () => {
    const base = { kind: 'job', workspaceId: ws, exchange: '', envelope: env };
    expect(outboxRowViolation({ ...base, routingKey: QUEUES.inbound })).toMatch(
      /^queue_not_allowed: hm\.q\.inbound$/,
    );
    expect(outboxRowViolation({ ...base, routingKey: QUEUES.kbIngest })).toMatch(
      /^queue_not_allowed/,
    );
    expect(
      outboxRowViolation({
        ...base,
        kind: 'event',
        exchange: EXCHANGES.events,
        routingKey: `${QUEUES.inbound}.x`,
      }),
    ).toMatch(/^event_routing_key_not_allowed/);
    expect(
      outboxRowViolation({ ...base, exchange: EXCHANGES.events, routingKey: 'domain.x' }),
    ).toMatch(/^job_exchange_not_allowed/);
    expect(
      outboxRowViolation({ ...base, kind: 'event', exchange: '', routingKey: QUEUES.media }),
    ).toMatch(/^event_exchange_not_allowed/);
    expect(outboxRowViolation({ ...base, kind: 'other', routingKey: QUEUES.media })).toMatch(
      /^kind_not_allowed/,
    );
    expect(
      outboxRowViolation({ ...base, routingKey: QUEUES.media, workspaceId: randomUUID() }),
    ).toMatch(/^workspace_mismatch/);
  });
});

describe('retenção da outbox', () => {
  it('mortos ficam 7 dias por padrão (dado pessoal), como os enviados', () => {
    expect(DEFAULT_OUTBOX_DEAD_RETENTION_DAYS).toBe(7);
    expect(DEFAULT_OUTBOX_SENT_RETENTION_DAYS).toBe(7);
  });

  it('OUTBOX_* do ambiente chegam ao relay; inválido cai no default', () => {
    expect(
      outboxRelayOptionsFromEnv({
        OUTBOX_DEAD_RETENTION_DAYS: '3',
        OUTBOX_SENT_RETENTION_DAYS: '2',
        OUTBOX_BATCH_SIZE: '50',
      }),
    ).toEqual({ batchSize: 50, cleanup: { sentRetentionDays: 2, deadRetentionDays: 3 } });
    expect(outboxRelayOptionsFromEnv({ OUTBOX_DEAD_RETENTION_DAYS: '0' })).toEqual({
      cleanup: {},
    });
  });
});

// ─── Integração: banco ───────────────────────────────────────────────────────────

describe.skipIf(!ready)('F70-S24 outbox confere envelope e fila', { timeout: 30_000 }, () => {
  const sfx = randomUUID().slice(0, 8);
  let wsA = '';
  let wsB = '';

  /** INSERT cru (o enqueueOutbox tira a coluna do envelope e não consegue divergir). */
  function rawInsert(r: {
    readonly workspaceId: string;
    readonly kind: string;
    readonly exchange: string;
    readonly routingKey: string;
    readonly envelope: Record<string, unknown>;
    readonly eventId?: string;
  }) {
    return sql`
      INSERT INTO outbox (event_id, kind, workspace_id, exchange, routing_key, envelope)
      VALUES (${r.eventId ?? randomUUID()}, ${r.kind}, ${r.workspaceId}::uuid, ${r.exchange},
              ${r.routingKey}, ${JSON.stringify(r.envelope)}::jsonb)`;
  }

  async function constraintDef(name: string): Promise<{ def: string; validated: boolean }> {
    const [row] = rows(
      await getDb().execute(sql`
        SELECT pg_get_constraintdef(c.oid) AS def, c.convalidated AS validated
          FROM pg_constraint c
         WHERE c.conrelid = 'public.outbox'::regclass AND c.conname = ${name}`),
    );
    if (row === undefined) throw new Error(`constraint ${name} não existe`);
    return { def: String(row['def']), validated: row['validated'] === true };
  }

  beforeAll(async () => {
    const db = getDb();
    const [a] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S24 A', slug: `f70s24a-${sfx}`, planId: null })
      .returning();
    const [b] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S24 B', slug: `f70s24b-${sfx}`, planId: null })
      .returning();
    if (!a || !b) throw new Error('workspaces não criados');
    wsA = a.id;
    wsB = b.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, wsA));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, wsB));
    await closeDb();
  });

  // ─── Fonte única ────────────────────────────────────────────────────────────────

  it('o CHECK de filas do banco e OUTBOX_JOB_QUEUES são a mesma lista', async () => {
    const { def, validated } = await constraintDef('outbox_job_queue_chk');
    expect(validated).toBe(true);
    const noBanco = [...def.matchAll(/'([^']+)'::text/g)]
      .map((m) => m[1] ?? '')
      .filter((q) => q !== '')
      .sort();
    // Diverge? Crie uma migração que recria `outbox_job_queue_chk` com a lista nova.
    expect(noBanco).toEqual([...OUTBOX_JOB_QUEUES].sort());

    const evento = await constraintDef('outbox_event_routing_chk');
    expect(evento.validated).toBe(true);
    expect(evento.def).toContain(`'${OUTBOX_EVENT_ROUTING_PREFIX}'`);
    expect(evento.def).toContain(`'${EXCHANGES.events}'`);
    for (const name of ['outbox_envelope_workspace_chk', 'outbox_kind_exchange_chk']) {
      expect((await constraintDef(name)).validated).toBe(true);
    }
  });

  it('índices únicos: só a PK e (workspace_id, event_id) — o ON CONFLICT sem alvo depende disso', async () => {
    const unicos = rows(
      await getDb().execute(sql`
        SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS def
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE i.indrelid = 'public.outbox'::regclass AND i.indisunique
         ORDER BY c.relname`),
    );
    expect(unicos.map((r) => r['name'])).toEqual(['outbox_pkey', 'uq_outbox_workspace_event']);
    expect(String(unicos[1]?.['def'])).toMatch(/\(workspace_id, event_id\)$/);
    const antigos = rows(
      await getDb().execute(sql`
        SELECT relname FROM pg_class
         WHERE relname IN ('uq_outbox_event_id', 'idx_outbox_workspace')`),
    );
    expect(antigos).toHaveLength(0);
  });

  it('hm_app só grava: sem SELECT (nem do event_id) e sem a policy de leitura', async () => {
    const [p] = rows(
      await getDb().execute(sql`
        SELECT has_table_privilege('hm_app', 'public.outbox', 'INSERT') AS ins,
               has_table_privilege('hm_app', 'public.outbox', 'SELECT') AS sel,
               has_column_privilege('hm_app', 'public.outbox', 'event_id', 'SELECT') AS sel_event,
               has_column_privilege('hm_app', 'public.outbox', 'workspace_id', 'SELECT') AS sel_ws`),
    );
    expect(p).toEqual({ ins: true, sel: false, sel_event: false, sel_ws: false });
    const policies = rows(
      await getDb().execute(sql`
        SELECT policyname FROM pg_policies WHERE tablename = 'outbox' ORDER BY policyname`),
    );
    expect(policies.map((r) => r['policyname'])).toEqual([
      'outbox_relay_all',
      'outbox_tenant_insert',
    ]);
  });

  // ─── DoD 1: envelope de outro workspace ─────────────────────────────────────────

  it('INSERT com envelope.workspaceId diferente da coluna → recusado pelo banco (hm_app e relay)', async () => {
    const env = makeEnvelope('outbound.job', wsB, {});
    const linha = {
      workspaceId: wsA,
      kind: 'job',
      exchange: '',
      routingKey: QUEUES.outbound,
      envelope: env,
    };

    // O cenário da auditoria: a RLS passa (coluna = workspace da transação), o envelope não.
    const pelaApi = await pgFailure(withWorkspace(wsA, (tx) => tx.execute(rawInsert(linha))));
    expect(pelaApi).toMatchObject({ code: '23514', constraint: 'outbox_envelope_workspace_chk' });

    // Vale para todo papel, não só para o hm_app.
    const peloDono = await pgFailure(getDb().execute(rawInsert(linha)));
    expect(peloDono).toMatchObject({ code: '23514', constraint: 'outbox_envelope_workspace_chk' });

    // Envelope sem workspaceId, ou com lixo no lugar: violação de CHECK, não erro de cast.
    const semWs: Record<string, unknown> = { ...env };
    delete semWs['workspaceId'];
    expect(
      await pgFailure(getDb().execute(rawInsert({ ...linha, envelope: semWs }))),
    ).toMatchObject({ code: '23514', constraint: 'outbox_envelope_workspace_chk' });
    expect(
      await pgFailure(
        getDb().execute(rawInsert({ ...linha, envelope: { ...env, workspaceId: 'x' } })),
      ),
    ).toMatchObject({ code: '23514', constraint: 'outbox_envelope_workspace_chk' });

    // O mesmo workspace em maiúsculas é o mesmo workspace.
    expect(
      await pgFailure(
        withWorkspace(wsA, (tx) =>
          tx.execute(rawInsert({ ...linha, envelope: { ...env, workspaceId: wsA.toUpperCase() } })),
        ),
      ),
    ).toBeNull();
  });

  // ─── DoD 2 (banco): fila fora da lista ──────────────────────────────────────────

  it('fila fora da lista → recusada pelo banco; as filas da lista passam', async () => {
    const env = makeEnvelope('inbound.message', wsA, {});
    const inbound: OutboxMessage = {
      kind: 'job',
      eventId: env.id,
      exchange: '',
      routingKey: QUEUES.inbound,
      envelope: env,
    };
    expect(await pgFailure(withWorkspace(wsA, (tx) => enqueueOutbox(tx, inbound)))).toMatchObject({
      code: '23514',
      constraint: 'outbox_job_queue_chk',
    });

    // Pelo hm.events, o bind `hm.q.<fila>.#` levaria à mesma fila: também recusado.
    expect(
      await pgFailure(
        withWorkspace(wsA, (tx) =>
          enqueueOutbox(tx, {
            ...inbound,
            kind: 'event',
            exchange: EXCHANGES.events,
            routingKey: `${QUEUES.inbound}.message`,
          }),
        ),
      ),
    ).toMatchObject({ code: '23514', constraint: 'outbox_event_routing_chk' });

    // job pelo exchange de eventos: kind e exchange incoerentes.
    expect(
      await pgFailure(
        withWorkspace(wsA, (tx) =>
          enqueueOutbox(tx, { ...inbound, exchange: EXCHANGES.events, routingKey: 'domain.x' }),
        ),
      ),
    ).toMatchObject({ code: '23514', constraint: 'outbox_kind_exchange_chk' });

    const aceitas = await withWorkspace(wsA, (tx) =>
      enqueueOutbox(
        tx,
        OUTBOX_JOB_QUEUES.map((q) => queueJobOutbox(q, makeEnvelope('t', wsA, { q }))),
      ),
    );
    expect(aceitas).toBe(OUTBOX_JOB_QUEUES.length);
  });

  // ─── DoD 3: event_id por workspace ──────────────────────────────────────────────

  it('mesmo event_id em dois workspaces → aceito; repetido no mesmo workspace → DO NOTHING', async () => {
    const conversationId = randomUUID();
    const opened = (ws: string) =>
      domainEventOutbox(
        domainEvents.conversationOpened(ws, {
          conversationId,
          contactId: null,
          channelId: null,
          trigger: 'inbound',
        }),
      );
    const a = opened(wsA);
    const b = opened(wsB);
    expect(a.eventId).toBe(b.eventId);

    expect(await withWorkspace(wsA, (tx) => enqueueOutbox(tx, a))).toBe(1);
    expect(await withWorkspace(wsB, (tx) => enqueueOutbox(tx, b))).toBe(1);
    // Mesmo workspace: não duplica e não aborta a transação (segue gravando depois).
    const [again, depois] = await withWorkspace(wsA, async (tx) => [
      await enqueueOutbox(tx, a),
      await enqueueOutbox(tx, queueJobOutbox(QUEUES.media, makeEnvelope('t', wsA, {}))),
    ]);
    expect([again, depois]).toEqual([0, 1]);

    const linhas = rows(
      await getDb().execute(sql`
        SELECT workspace_id FROM outbox WHERE event_id = ${a.eventId} ORDER BY id`),
    );
    expect(linhas.map((r) => r['workspace_id'])).toEqual([wsA, wsB]);
  });

  // ─── DoD 2 (relay): linha que passou por fora do CHECK ──────────────────────────

  it('relay: fila fora da lista, tenant trocado ou evento fora de domain.* → dead, nada publicado', async () => {
    const guarded = [
      'outbox_job_queue_chk',
      'outbox_envelope_workspace_chk',
      'outbox_event_routing_chk',
    ] as const;
    const defs = new Map<string, string>();
    for (const name of guarded) defs.set(name, (await constraintDef(name)).def);

    const fila = makeEnvelope('inbound.message', wsA, {});
    const tenant = makeEnvelope('outbound.job', wsB, {});
    const evento = makeEnvelope('x', wsA, {});
    const valido = queueJobOutbox(QUEUES.media, makeEnvelope('media.download', wsA, {}));

    // Simula a linha que escapou do CHECK (constraint removida à mão): tira os CHECKs e
    // grava. Eles voltam, validados, no `finally`. (NOT VALID não serve: o CHECK vale no
    // UPDATE, e o relay não conseguiria marcar a linha.) Janela curta, e só no banco de
    // teste; se o processo morrer no meio, o teste de fonte única acusa o CHECK ausente.
    await getDb().transaction(async (tx) => {
      for (const name of guarded) {
        await tx.execute(sql.raw(`ALTER TABLE outbox DROP CONSTRAINT ${name}`));
      }
      await tx.execute(
        rawInsert({
          workspaceId: wsA,
          kind: 'job',
          exchange: '',
          routingKey: QUEUES.inbound,
          envelope: fila,
          eventId: fila.id,
        }),
      );
      await tx.execute(
        rawInsert({
          workspaceId: wsA,
          kind: 'job',
          exchange: '',
          routingKey: QUEUES.outbound,
          envelope: tenant,
          eventId: tenant.id,
        }),
      );
      await tx.execute(
        rawInsert({
          workspaceId: wsA,
          kind: 'event',
          exchange: EXCHANGES.events,
          routingKey: `${QUEUES.inbound}.message`,
          envelope: evento,
          eventId: evento.id,
        }),
      );
    });

    const publicados: ConfirmPublishItem[] = [];
    const publisher: ConfirmPublisher = {
      publishBatch: async (items) => {
        publicados.push(...items);
        return new Map(items.map((i) => [i.key, null]));
      },
      isOpen: () => true,
      close: async () => undefined,
    };
    const log = makeLogger();
    const relay = new OutboxRelay({
      logger: log.logger,
      workspaceId: wsA,
      listen: false,
      cleanup: false,
      pollIntervalMs: 50,
      connectPublisher: async () => publisher,
    });

    try {
      await withWorkspace(wsA, (tx) => enqueueOutbox(tx, valido));
      await relay.start();
      const ids = [fila.id, tenant.id, evento.id, valido.eventId];
      const estado = await waitFor(
        async () =>
          rows(
            await getDb().execute(sql`
              SELECT event_id, status, attempts, last_error FROM outbox
               WHERE workspace_id = ${wsA}::uuid
                 AND event_id IN (${sql.raw(ids.map(lit).join(', '))})`),
          ),
        (rs) => rs.length === 4 && rs.every((r) => r['status'] !== 'pending'),
      );
      const por = new Map(estado.map((r) => [String(r['event_id']), r]));
      expect(por.get(fila.id)).toMatchObject({ status: 'dead', attempts: 1 });
      expect(String(por.get(fila.id)?.['last_error'])).toMatch(
        /^queue_not_allowed: hm\.q\.inbound/,
      );
      expect(por.get(tenant.id)).toMatchObject({ status: 'dead' });
      expect(String(por.get(tenant.id)?.['last_error'])).toMatch(/^workspace_mismatch/);
      expect(por.get(evento.id)).toMatchObject({ status: 'dead' });
      expect(String(por.get(evento.id)?.['last_error'])).toMatch(/^event_routing_key_not_allowed/);
      expect(por.get(valido.eventId)).toMatchObject({ status: 'sent' });

      // Nenhuma das recusadas chegou ao broker; a válida (e as pendentes dos outros
      // testes deste workspace) sim.
      const publicadosIds = publicados.map((p) => p.envelope.id);
      expect(publicadosIds).toContain(valido.envelope.id);
      for (const id of [fila.id, tenant.id, evento.id]) expect(publicadosIds).not.toContain(id);
      expect(
        publicados.every(
          (p) =>
            outboxRowViolation({
              ...p,
              kind: p.exchange === '' ? 'job' : 'event',
              workspaceId: wsA,
            }) === null,
        ),
      ).toBe(true);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('recusada antes de publicar'),
        expect.objectContaining({ eventId: fila.id, routingKey: QUEUES.inbound, workspaceId: wsA }),
      );
      // O log não carrega o payload.
      for (const call of log.error.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('"payload"');
      }
    } finally {
      await relay.stop();
      await getDb().execute(sql`
        DELETE FROM outbox
         WHERE workspace_id = ${wsA}::uuid
           AND event_id IN (${sql.raw([fila.id, tenant.id, evento.id].map(lit).join(', '))})`);
      for (const name of guarded) {
        await getDb().execute(
          sql.raw(`ALTER TABLE outbox ADD CONSTRAINT ${name} ${defs.get(name) ?? ''}`),
        );
      }
    }
    for (const name of guarded) expect((await constraintDef(name)).validated).toBe(true);
  });

  // ─── Pré-voo da 0091 ────────────────────────────────────────────────────────────

  it('pré-voo da 0091 aborta com a contagem por regra se houver linha violando', async () => {
    const file = readFileSync(MIGRATION_0091, 'utf8');
    const preflight = /DO \$preflight\$[\s\S]*?END \$preflight\$;/.exec(file)?.[0];
    expect(preflight).toBeDefined();

    // Estado atual: passa.
    expect(await pgFailure(getDb().execute(sql.raw(preflight ?? '')))).toBeNull();

    // Linhas violando (numa transação que volta): aborta, conta e não altera nada.
    const env = makeEnvelope('x', wsB, {});
    const falha = await pgFailure(
      getDb().transaction(async (tx) => {
        await tx.execute(
          sql.raw(`ALTER TABLE outbox
            DROP CONSTRAINT outbox_envelope_workspace_chk,
            DROP CONSTRAINT outbox_job_queue_chk`),
        );
        await tx.execute(
          rawInsert({
            workspaceId: wsA,
            kind: 'job',
            exchange: '',
            routingKey: QUEUES.inbound,
            envelope: env,
          }),
        );
        await tx.execute(sql.raw(preflight ?? ''));
      }),
    );
    expect(falha?.message).toMatch(/^F70-S24: 2 violação\(ões\) em outbox; nada foi alterado/);
    expect(falha?.detail).toBe('envelope_workspace=1 kind_exchange=0 job_queue=1 event_routing=0');
    // O rollback devolveu os CHECKs.
    expect((await constraintDef('outbox_job_queue_chk')).validated).toBe(true);
    expect((await constraintDef('outbox_envelope_workspace_chk')).validated).toBe(true);
  });
});
