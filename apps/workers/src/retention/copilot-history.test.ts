/**
 * F73-S15 · retenção do histórico do Copiloto contra o Postgres de dev.
 *
 * Três workspaces (6, 12 [sem linha em `copilot_settings`] e 24 meses) com o MESMO conjunto de
 * dados, em idades absolutas relativas a `NOW` (2026-10-17):
 *
 *   recente 2026-10-01 · 7 meses 2026-03-01 · 16 meses 2025-06-01 · 28 meses 2024-06-01
 *
 * cada idade com uma sessão que tem turno + chamada de ferramenta + uma mensagem; mais uma sessão
 * vazia de 28 meses, uma vazia de 7 meses, uma de 7 meses com mensagem e SEM turno e uma sessão
 * recente com uma mensagem velha (16 meses) e uma nova. Provado: o prazo de cada workspace manda;
 * mensagens além dele somem; sessões vazias além dele somem; sessões com turno viram casco sem
 * texto; propostas, itens, turnos, chamadas de ferramenta, auditoria e uso de LLM ficam intactos;
 * repetir é idempotente; o lote respeita o teto; e o lock deixa uma instância só varrer.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import {
  COPILOT_HISTORY_LOCK_KEY,
  createCopilotHistoryPort,
  runCopilotHistoryOnce,
  runCopilotHistorySweep,
  subtractMonths,
  type CopilotHistoryPort,
  type RedisLike,
} from './index';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const AGES = {
  recent: new Date('2026-10-01T10:00:00Z'),
  m7: new Date('2026-03-01T10:00:00Z'),
  m16: new Date('2025-06-01T10:00:00Z'),
  m28: new Date('2024-06-01T10:00:00Z'),
} as const;
type Age = keyof typeof AGES;
const AGE_KEYS = Object.keys(AGES) as Age[];

interface World {
  readonly workspaceId: string;
  readonly months: 6 | 12 | 24;
  readonly memberId: string;
  readonly withTurn: Record<Age, { sessionId: string; turnId: string; messageId: string }>;
  readonly emptyOld: string;
  readonly empty7: string;
  readonly noTurn7: { sessionId: string; messageId: string };
  readonly mixed: { sessionId: string; oldMessageId: string; newMessageId: string };
  readonly proposalId: string;
}

const worlds: World[] = [];
const logger = createLogger('error', { svc: 'test' });

async function seedWorld(months: 6 | 12 | 24, withSettings: boolean): Promise<World> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: `Retention ${months} ${sfx}`, slug: `ret-${months}-${sfx}` })
    .returning();
  if (!ws) throw new Error('seed: workspace');
  if (withSettings) {
    await db
      .insert(schema.copilotSettings)
      .values({ workspaceId: ws.id, historyRetentionMonths: months });
  }
  const [member] = await db
    .insert(schema.members)
    .values({
      workspaceId: ws.id,
      authUserId: randomUUID(),
      email: `ret-${sfx}@t.local`,
      name: 'Membro',
      role: 'OWNER',
      status: 'active',
    })
    .returning();
  if (!member) throw new Error('seed: membro');

  const session = async (updatedAt: Date, title: string | null = 'Conversa'): Promise<string> => {
    const [s] = await db
      .insert(schema.copilotSessions)
      .values({
        workspaceId: ws.id,
        memberId: member.id,
        origin: 'bubble',
        title,
        lastPageContext: { route: '/pipeline' },
        createdAt: updatedAt,
        updatedAt,
      })
      .returning();
    if (!s) throw new Error('seed: sessão');
    return s.id;
  };
  const message = async (sessionId: string, at: Date, turnId?: string): Promise<string> => {
    const [m] = await db
      .insert(schema.copilotMessages)
      .values({
        workspaceId: ws.id,
        sessionId,
        role: 'user',
        content: 'Quais negócios estão parados?',
        createdAt: at,
        ...(turnId ? { turnId } : {}),
      })
      .returning();
    if (!m) throw new Error('seed: mensagem');
    return m.id;
  };

  const withTurn = {} as World['withTurn'];
  for (const age of AGE_KEYS) {
    const at = AGES[age];
    const sessionId = await session(at);
    const [turn] = await db
      .insert(schema.copilotTurns)
      .values({
        workspaceId: ws.id,
        memberId: member.id,
        sessionId,
        status: 'completed',
        grantNonce: `nonce-${randomUUID()}`,
        expiresAt: new Date(at.getTime() + 120_000),
        maxToolCalls: 16,
        startedAt: at,
        completedAt: new Date(at.getTime() + 2_000),
        costUsd: '0.10',
      })
      .returning();
    if (!turn) throw new Error('seed: turno');
    await db.insert(schema.copilotToolCalls).values({
      workspaceId: ws.id,
      turnId: turn.id,
      memberId: member.id,
      toolKey: 'get_pipeline_overview',
      decision: 'executed',
      createdAt: at,
    });
    await db.insert(schema.llmUsageLogs).values({
      workspaceId: ws.id,
      requestType: 'chat',
      model: 'openai/gpt-4.1-mini',
      costUsd: '0.10',
      surface: 'copilot',
      copilotTurnId: turn.id,
      createdAt: at,
    });
    const messageId = await message(sessionId, at, turn.id);
    withTurn[age] = { sessionId, turnId: turn.id, messageId };
  }

  const emptyOld = await session(AGES.m28, null);
  const empty7 = await session(AGES.m7, null);
  const noTurnSession = await session(AGES.m7);
  const noTurn7 = { sessionId: noTurnSession, messageId: await message(noTurnSession, AGES.m7) };
  const mixedSession = await session(AGES.recent);
  const mixed = {
    sessionId: mixedSession,
    oldMessageId: await message(mixedSession, AGES.m16),
    newMessageId: await message(mixedSession, AGES.recent),
  };

  // Trilha: proposta do turno de 28 meses, com item e auditoria; a mensagem aponta para ela.
  const old = withTurn.m28;
  const [proposal] = await db
    .insert(schema.copilotActionProposals)
    .values({
      workspaceId: ws.id,
      sessionId: old.sessionId,
      turnId: old.turnId,
      capability: 'deal.move',
      riskLevel: 3,
      status: 'completed',
      requestedByMemberId: member.id,
      summary: 'Mover 3 negócios',
      createdAt: AGES.m28,
    })
    .returning();
  if (!proposal) throw new Error('seed: proposta');
  await db.insert(schema.copilotActionItems).values({
    workspaceId: ws.id,
    proposalId: proposal.id,
    position: 0,
    targetType: 'deal',
    targetId: randomUUID(),
    status: 'done',
  });
  await db
    .update(schema.copilotMessages)
    .set({ proposalId: proposal.id })
    .where(eq(schema.copilotMessages.id, old.messageId));
  await db.insert(schema.auditLogs).values({
    workspaceId: ws.id,
    actorType: 'copilot',
    actorMemberId: member.id,
    action: 'copilot.proposal.completed',
    resourceType: 'copilot_proposal',
    resourceId: proposal.id,
    copilotProposalId: proposal.id,
    copilotTurnId: old.turnId,
    metadata: {},
    createdAt: AGES.m28,
  });

  return {
    workspaceId: ws.id,
    months,
    memberId: member.id,
    withTurn,
    emptyOld,
    empty7,
    noTurn7,
    mixed,
    proposalId: proposal.id,
  };
}

interface Counts {
  readonly messages: number;
  readonly sessions: number;
  readonly turns: number;
  readonly toolCalls: number;
  readonly proposals: number;
  readonly items: number;
  readonly audit: number;
  readonly usage: number;
}

async function count(table: keyof typeof schema, ws: string): Promise<number> {
  const t = schema[table] as unknown as { workspaceId: never };
  const rows = await getDb()
    .select()
    .from(schema[table] as never)
    .where(eq(t.workspaceId, ws));
  return rows.length;
}

async function counts(ws: string): Promise<Counts> {
  return {
    messages: await count('copilotMessages', ws),
    sessions: await count('copilotSessions', ws),
    turns: await count('copilotTurns', ws),
    toolCalls: await count('copilotToolCalls', ws),
    proposals: await count('copilotActionProposals', ws),
    items: await count('copilotActionItems', ws),
    audit: await count('auditLogs', ws),
    usage: await count('llmUsageLogs', ws),
  };
}

async function existingMessages(ids: string[]): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: schema.copilotMessages.id })
    .from(schema.copilotMessages)
    .where(inArray(schema.copilotMessages.id, ids));
  return new Set(rows.map((r) => r.id));
}

async function sessionRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.copilotSessions)
    .where(eq(schema.copilotSessions.id, id));
  return row ?? null;
}

/** Redis mínimo em memória (SET NX PX + unlock por Lua), o suficiente para o lock. */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>();
  async set(key: string, value: string, _mode: 'PX', _ttl: number, _cond: 'NX') {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK' as const;
  }
  async eval(_script: string, _n: number, key: string, token: string) {
    if (this.store.get(key) === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

/** Só os workspaces deste teste (o dev tem outros): filtra a listagem da porta real. */
function scopedPort(): CopilotHistoryPort {
  const real = createCopilotHistoryPort();
  const mine = new Set(worlds.map((w) => w.workspaceId));
  return {
    ...real,
    async listTargets() {
      return (await real.listTargets()).filter((t) => mine.has(t.workspaceId));
    },
  };
}

let w6: World;
let w12: World;
let w24: World;
const before = new Map<string, Counts>();

beforeAll(async () => {
  w6 = await seedWorld(6, true);
  w12 = await seedWorld(12, false); // sem linha em copilot_settings: default de 12 meses
  w24 = await seedWorld(24, true);
  worlds.push(w6, w12, w24);
  for (const w of worlds) before.set(w.workspaceId, await counts(w.workspaceId));
});

afterAll(async () => {
  for (const w of worlds) {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, w.workspaceId));
  }
  await closeDb();
});

describe('subtractMonths', () => {
  it('preserva o dia e limita ao fim do mês', () => {
    expect(subtractMonths(new Date('2026-10-17T12:00:00Z'), 6).toISOString()).toBe(
      '2026-04-17T12:00:00.000Z',
    );
    expect(subtractMonths(new Date('2026-03-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(subtractMonths(new Date('2026-01-15T00:00:00Z'), 24).toISOString()).toBe(
      '2024-01-15T00:00:00.000Z',
    );
  });
});

describe('retenção do histórico do Copiloto (banco de dev)', () => {
  it('a varredura respeita o prazo de cada workspace', async () => {
    const result = await runCopilotHistorySweep(scopedPort(), {
      now: NOW,
      batchSize: 100,
      maxBatches: 100,
    });
    expect(result.errors).toBe(0);
    expect(result.workspaces).toBe(3);
    expect(result.reachedCap).toBe(false);

    // Mensagens que sobram: 6 meses → só as recentes; 12 → +7 meses; 24 → +16 meses.
    const keepers: Record<6 | 12 | 24, Age[]> = {
      6: ['recent'],
      12: ['recent', 'm7'],
      24: ['recent', 'm7', 'm16'],
    };
    for (const w of worlds) {
      const kept = new Set(keepers[w.months]);
      const alive = await existingMessages([
        ...AGE_KEYS.map((a) => w.withTurn[a].messageId),
        w.noTurn7.messageId,
        w.mixed.oldMessageId,
        w.mixed.newMessageId,
      ]);
      for (const age of AGE_KEYS) {
        expect(alive.has(w.withTurn[age].messageId), `${w.months}m · mensagem ${age}`).toBe(
          kept.has(age),
        );
      }
      expect(alive.has(w.noTurn7.messageId), `${w.months}m · mensagem sem turno`).toBe(
        kept.has('m7'),
      );
      expect(alive.has(w.mixed.oldMessageId), `${w.months}m · mensagem velha da sessão viva`).toBe(
        kept.has('m16'),
      );
      expect(alive.has(w.mixed.newMessageId)).toBe(true);
    }
  });

  it('sessões: vazias além do prazo somem; com turno viram casco sem texto; recentes intactas', async () => {
    for (const w of worlds) {
      const label = `${w.months}m`;
      const expiredAges = AGE_KEYS.filter((a) => {
        const cutoff = subtractMonths(NOW, w.months);
        return AGES[a] < cutoff;
      });

      // Vazia de 28 meses: apagada em todos. Vazia de 7 meses: só onde 7 meses passa do prazo.
      expect(await sessionRow(w.emptyOld), `${label} · vazia 28m`).toBeNull();
      const seven = expiredAges.includes('m7');
      expect(await sessionRow(w.empty7), `${label} · vazia 7m`).toSatisfy((r: unknown) =>
        seven ? r === null : r !== null,
      );
      // Sem turno, com mensagem de 7 meses: some junto com a mensagem onde o prazo passou.
      expect(await sessionRow(w.noTurn7.sessionId), `${label} · sem turno 7m`).toSatisfy(
        (r: unknown) => (seven ? r === null : r !== null),
      );

      for (const age of AGE_KEYS) {
        const row = await sessionRow(w.withTurn[age].sessionId);
        // Sessão com turno NUNCA é apagada (o turno e as chamadas de ferramenta dependem dela).
        expect(row, `${label} · sessão ${age} existe`).not.toBeNull();
        if (expiredAges.includes(age)) {
          expect(row?.title, `${label} · ${age} título`).toBeNull();
          expect(row?.lastPageContext, `${label} · ${age} contexto`).toBeNull();
          expect(row?.archivedAt, `${label} · ${age} arquivada`).not.toBeNull();
        } else {
          expect(row?.title, `${label} · ${age} título`).toBe('Conversa');
          expect(row?.lastPageContext).toEqual({ route: '/pipeline' });
          expect(row?.archivedAt).toBeNull();
        }
      }
      // A sessão viva com uma mensagem velha segue com o título.
      expect((await sessionRow(w.mixed.sessionId))?.title).toBe('Conversa');
    }
  });

  it('preserva propostas, itens, turnos, chamadas de ferramenta, auditoria e uso de LLM', async () => {
    for (const w of worlds) {
      const b = before.get(w.workspaceId)!;
      const a = await counts(w.workspaceId);
      expect(a.turns, 'turnos').toBe(b.turns);
      expect(a.toolCalls, 'chamadas de ferramenta').toBe(b.toolCalls);
      expect(a.proposals, 'propostas').toBe(b.proposals);
      expect(a.items, 'itens').toBe(b.items);
      expect(a.audit, 'auditoria').toBe(b.audit);
      expect(a.usage, 'uso de LLM').toBe(b.usage);
      expect(a.messages).toBeLessThan(b.messages);
      expect(a.sessions).toBeLessThan(b.sessions);
    }
    // A proposta do turno velho segue ligada ao turno e à sessão (casco), com a trilha inteira.
    for (const w of worlds) {
      const [p] = await getDb()
        .select()
        .from(schema.copilotActionProposals)
        .where(eq(schema.copilotActionProposals.id, w.proposalId));
      expect(p).toMatchObject({
        sessionId: w.withTurn.m28.sessionId,
        turnId: w.withTurn.m28.turnId,
        status: 'completed',
        summary: 'Mover 3 negócios',
      });
      const audits = await getDb()
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.workspaceId, w.workspaceId),
            eq(schema.auditLogs.copilotProposalId, w.proposalId),
          ),
        );
      expect(audits).toHaveLength(1);
    }
  });

  it('é idempotente: a segunda passada não remove nem altera nada', async () => {
    const afterFirst = await Promise.all(worlds.map((w) => counts(w.workspaceId)));
    const result = await runCopilotHistorySweep(scopedPort(), {
      now: NOW,
      batchSize: 100,
      maxBatches: 100,
    });
    expect(result).toMatchObject({
      messagesDeleted: 0,
      sessionsDeleted: 0,
      sessionsScrubbed: 0,
      errors: 0,
    });
    expect(await Promise.all(worlds.map((w) => counts(w.workspaceId)))).toEqual(afterFirst);
  });
});

describe('lotes, teto e lock', () => {
  it('o teto de lotes limita o trabalho do tick e o seguinte continua de onde parou', async () => {
    const fresh = await seedWorld(6, true);
    worlds.push(fresh);
    const port = {
      ...createCopilotHistoryPort(),
      async listTargets() {
        return [{ workspaceId: fresh.workspaceId, retentionMonths: 6 }];
      },
    } satisfies CopilotHistoryPort;

    // Alvos deste mundo: 3 mensagens (7m, 16m, 28m) + 1 velha da sessão viva + 1 sem turno = 5.
    const first = await runCopilotHistorySweep(port, { now: NOW, batchSize: 2, maxBatches: 1 });
    expect(first).toMatchObject({ messagesDeleted: 2, batches: 1, reachedCap: true });
    const second = await runCopilotHistorySweep(port, { now: NOW, batchSize: 2, maxBatches: 100 });
    expect(second.reachedCap).toBe(false);
    expect(first.messagesDeleted + second.messagesDeleted).toBe(5);
  });

  it('um workspace que falha não derruba os demais', async () => {
    const errors: string[] = [];
    const good = worlds[0]!;
    const port: CopilotHistoryPort = {
      async listTargets() {
        return [
          { workspaceId: '00000000-0000-0000-0000-00000000dead', retentionMonths: 12 },
          { workspaceId: good.workspaceId, retentionMonths: 12 },
        ];
      },
      deleteMessages: async (ws) => {
        if (ws.endsWith('dead')) throw new Error('falha simulada');
        return 0;
      },
      deleteSessions: async () => 0,
      scrubSessions: async () => 0,
    };
    const result = await runCopilotHistorySweep(port, {
      now: NOW,
      batchSize: 10,
      maxBatches: 10,
      onError: (ws) => errors.push(ws),
    });
    expect(result.errors).toBe(1);
    expect(errors).toEqual(['00000000-0000-0000-0000-00000000dead']);
    expect(result.batches).toBe(3); // as três fases do workspace saudável
  });

  it('lock singleton: com o lock ocupado a passada não varre; sem ele, varre e libera', async () => {
    const redis = new FakeRedis();
    let calls = 0;
    const port: CopilotHistoryPort = {
      async listTargets() {
        calls += 1;
        return [];
      },
      deleteMessages: async () => 0,
      deleteSessions: async () => 0,
      scrubSessions: async () => 0,
    };
    const deps = {
      redis,
      logger,
      port,
      config: { batchSize: 10, maxBatchesPerTick: 10 },
      now: () => NOW,
    };
    redis.store.set(COPILOT_HISTORY_LOCK_KEY, 'outra-instancia');
    expect(await runCopilotHistoryOnce(deps)).toBeNull();
    expect(calls).toBe(0);

    redis.store.delete(COPILOT_HISTORY_LOCK_KEY);
    expect(await runCopilotHistoryOnce(deps)).not.toBeNull();
    expect(calls).toBe(1);
    expect(redis.store.has(COPILOT_HISTORY_LOCK_KEY)).toBe(false);
  });
});
