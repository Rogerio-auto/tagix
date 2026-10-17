/**
 * F73-S13 · worker do piloto automático.
 *
 *   - lock REAL no Redis de dev: dois ticks ao mesmo tempo, um processa e o outro devolve
 *     `ran: false`; o lock é liberado e um tick seguinte processa;
 *   - páginas de workspaces, falha isolada por workspace, prazo;
 *   - ponta a ponta contra o Postgres de dev: a regra do workspace gera a sugestão, o evento sai
 *     só com a contagem, repetir não duplica nem reemite.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  copilotAutopilotRepo,
  getDb,
  schema,
  withWorkspace,
  type GenerateSuggestionsResult,
} from '@hm/db';
import { createLogger } from '@hm/logger';
import { createRedisClient } from '../redis/client';
import {
  createDbCopilotAutopilotPort,
  runCopilotAutopilotTick,
  type CopilotAutopilotPort,
  type CopilotAutopilotTickDeps,
} from './index';

const logger = createLogger('error', { svc: 'test' });
const redis = createRedisClient();
const NOW = new Date('2026-10-16T12:00:00Z');
const DAY = 86_400_000;

const result = (over: Partial<GenerateSuggestionsResult> = {}): GenerateSuggestionsResult => ({
  rules: 1,
  invalidRules: 0,
  created: 0,
  expired: 0,
  superseded: 0,
  pendingCount: 0,
  ...over,
});

function newLockKey(): string {
  return `hm:lock:scheduler:copilot-autopilot:test:${randomUUID()}`;
}

function deps(
  port: CopilotAutopilotPort,
  emitted: Array<{ workspaceId: string; pending: number }> = [],
  over: Partial<CopilotAutopilotTickDeps> = {},
): CopilotAutopilotTickDeps {
  return {
    redis,
    logger,
    port,
    now: () => NOW,
    lockKey: newLockKey(),
    emit: async (workspaceId, payload) => {
      emitted.push({ workspaceId, pending: payload.pending_count });
    },
    ...over,
  };
}

afterAll(async () => {
  redis.disconnect();
  await closeDb();
});

describe('lock singleton (Redis de verdade)', () => {
  it('dois ticks simultâneos: um processa, o outro desiste; depois o lock está livre', async () => {
    const lockKey = newLockKey();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generated: string[] = [];
    const port: CopilotAutopilotPort = {
      async listWorkspaces(after) {
        return after === null ? ['ws-1', 'ws-2'] : [];
      },
      async generate(workspaceId) {
        generated.push(workspaceId);
        await gate; // segura o lock enquanto o outro tick tenta
        return result({ created: 1, pendingCount: 1 });
      },
    };
    const emitted: Array<{ workspaceId: string; pending: number }> = [];
    const d = deps(port, emitted, { lockKey });

    const first = runCopilotAutopilotTick(d);
    // Dá tempo de o primeiro entrar na seção crítica.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const second = await runCopilotAutopilotTick(d);
    expect(second).toMatchObject({ ran: false, workspaces: 0, created: 0 });
    expect(generated).toEqual(['ws-1']);

    release();
    const done = await first;
    expect(done).toMatchObject({ ran: true, workspaces: 2, created: 2, errors: 0 });
    expect(generated).toEqual(['ws-1', 'ws-2']);
    expect(emitted).toEqual([
      { workspaceId: 'ws-1', pending: 1 },
      { workspaceId: 'ws-2', pending: 1 },
    ]);

    // Lock liberado: o próximo tick roda.
    expect(await redis.get(lockKey)).toBeNull();
    const third = await runCopilotAutopilotTick(d);
    expect(third.ran).toBe(true);
  });

  it('Promise.all de dois ticks: exatamente um `ran`', async () => {
    const calls: string[] = [];
    const port: CopilotAutopilotPort = {
      async listWorkspaces(after) {
        return after === null ? ['solo'] : [];
      },
      async generate(workspaceId) {
        calls.push(workspaceId);
        await new Promise((resolve) => setTimeout(resolve, 100));
        return result();
      },
    };
    const d = deps(port);
    const [a, b] = await Promise.all([runCopilotAutopilotTick(d), runCopilotAutopilotTick(d)]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    expect(calls).toEqual(['solo']);
  });
});

describe('lotes e isolamento', () => {
  it('pagina os workspaces (keyset) e processa todos', async () => {
    const all = Array.from({ length: 7 }, (_, i) => `ws-${i}`);
    const pages: Array<string | null> = [];
    const port: CopilotAutopilotPort = {
      async listWorkspaces(after, limit) {
        pages.push(after);
        const start = after === null ? 0 : all.indexOf(after) + 1;
        return all.slice(start, start + limit);
      },
      generate: async () => result(),
    };
    const out = await runCopilotAutopilotTick(deps(port, [], { workspaceBatch: 3 }));
    expect(out).toMatchObject({ ran: true, workspaces: 7, errors: 0 });
    expect(pages).toEqual([null, 'ws-2', 'ws-5']);
  });

  it('um workspace que falha não derruba os outros; só emite quando a fila mudou', async () => {
    const emitted: Array<{ workspaceId: string; pending: number }> = [];
    const port: CopilotAutopilotPort = {
      async listWorkspaces(after) {
        return after === null ? ['bom', 'ruim', 'quieto', 'expira'] : [];
      },
      async generate(workspaceId) {
        if (workspaceId === 'ruim') throw new Error('boom');
        if (workspaceId === 'quieto') return result();
        if (workspaceId === 'expira') return result({ expired: 2, superseded: 1, pendingCount: 4 });
        return result({ created: 3, pendingCount: 3 });
      },
    };
    const out = await runCopilotAutopilotTick(deps(port, emitted));
    expect(out).toMatchObject({
      ran: true,
      workspaces: 4,
      created: 3,
      expired: 2,
      superseded: 1,
      errors: 1,
      reachedDeadline: false,
    });
    expect(emitted).toEqual([
      { workspaceId: 'bom', pending: 3 },
      { workspaceId: 'expira', pending: 4 },
    ]);
  });

  it('para de abrir workspace ao passar do prazo de posse do lock', async () => {
    const generated: string[] = [];
    const port: CopilotAutopilotPort = {
      async listWorkspaces(after) {
        return after === null ? ['a', 'b', 'c'] : [];
      },
      async generate(workspaceId) {
        generated.push(workspaceId);
        await new Promise((resolve) => setTimeout(resolve, 60));
        return result();
      },
    };
    // Posse de 100 ms: 90% = 90 ms → o 2º workspace ainda entra, o 3º não.
    const out = await runCopilotAutopilotTick(deps(port, [], { lockTtlMs: 100 }));
    expect(out.reachedDeadline).toBe(true);
    expect(generated.length).toBeLessThan(3);
  });
});

describe('ponta a ponta contra o Postgres de dev', () => {
  const created: string[] = [];
  let onWs: {
    ws: string;
    stage: string;
    target: string;
    owner: string;
    pipeline: string;
    contact: string;
  };
  let noRule: string;
  let off: string;

  async function seed(label: string) {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(schema.workspaces)
      .values({ name: `S13 worker ${label}`, slug: `s13w-${label}-${sfx}` })
      .returning();
    if (!w) throw new Error('seed ws');
    created.push(w.id);
    const [owner] = await db
      .insert(schema.members)
      .values({
        workspaceId: w.id,
        authUserId: randomUUID(),
        email: `s13w-${label}-${sfx}@test.local`,
        role: 'OWNER',
        status: 'active',
      })
      .returning();
    const [pl] = await db
      .insert(schema.pipelines)
      .values({ workspaceId: w.id, name: 'F' })
      .returning();
    const [ct] = await db
      .insert(schema.contacts)
      .values({ workspaceId: w.id, displayName: label })
      .returning();
    if (!owner || !pl || !ct) throw new Error('seed base');
    const [a] = await db
      .insert(schema.stages)
      .values({ workspaceId: w.id, pipelineId: pl.id, name: 'A', position: 0 })
      .returning();
    const [b] = await db
      .insert(schema.stages)
      .values({ workspaceId: w.id, pipelineId: pl.id, name: 'B', position: 1 })
      .returning();
    if (!a || !b) throw new Error('seed stages');
    await db.insert(schema.deals).values({
      workspaceId: w.id,
      pipelineId: pl.id,
      stageId: a.id,
      contactId: ct.id,
      title: `Negócio ${label}`,
      createdAt: new Date(NOW.getTime() - 10 * DAY),
      updatedAt: new Date(NOW.getTime() - 10 * DAY),
    });
    return {
      ws: w.id,
      stage: a.id,
      target: b.id,
      owner: owner.id,
      pipeline: pl.id,
      contact: ct.id,
    };
  }

  const setRule = (w: typeof onWs, mode: 'suggest' | 'off') =>
    withWorkspace(w.ws, (tx) =>
      copilotAutopilotRepo.upsertRule(tx, {
        workspaceId: w.ws,
        stageId: w.stage,
        mode,
        criteria: { idle_days: 3, target_stage_id: w.target, require_last_outbound: false },
        memberId: w.owner,
      }),
    );

  beforeAll(async () => {
    onWs = await seed('com-regra');
    const semRegra = await seed('sem-regra');
    const desligada = await seed('desligada');
    noRule = semRegra.ws;
    off = desligada.ws;
    await setRule(onWs, 'suggest');
    await setRule(desligada, 'off');
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of created) {
      await db.delete(schema.deals).where(eq(schema.deals.workspaceId, id));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
    }
  });

  /** O dev tem outros workspaces com regra: a listagem real é filtrada para os deste teste. */
  function scopedPort(): CopilotAutopilotPort {
    const real = createDbCopilotAutopilotPort();
    const mine = new Set(created);
    return {
      generate: (ws, now) => real.generate(ws, now),
      async listWorkspaces(after, limit) {
        const out: string[] = [];
        let cursor = after;
        while (out.length < limit) {
          const page = await real.listWorkspaces(cursor, 50);
          if (page.length === 0) break;
          out.push(...page.filter((id) => mine.has(id)));
          cursor = page[page.length - 1] ?? null;
          if (page.length < 50) break;
        }
        return out.slice(0, limit);
      },
    };
  }

  it('gera a sugestão só do workspace com regra ligada, emite a contagem e não repete', async () => {
    const emitted: Array<{ workspaceId: string; pending: number }> = [];
    const d = deps(scopedPort(), emitted);

    const first = await runCopilotAutopilotTick(d);
    expect(first).toMatchObject({ ran: true, workspaces: 1, created: 1, errors: 0 });
    expect(emitted).toEqual([{ workspaceId: onWs.ws, pending: 1 }]);

    const rows = await getDb()
      .select()
      .from(schema.copilotSuggestions)
      .where(eq(schema.copilotSuggestions.workspaceId, onWs.ws));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      fromStageId: onWs.stage,
      toStageId: onWs.target,
      reasonCode: 'idle_no_messages',
    });
    for (const other of [noRule, off]) {
      const none = await getDb()
        .select()
        .from(schema.copilotSuggestions)
        .where(eq(schema.copilotSuggestions.workspaceId, other));
      expect(none).toHaveLength(0);
    }

    // Segundo tick: nada novo, nada emitido.
    const second = await runCopilotAutopilotTick(d);
    expect(second).toMatchObject({ ran: true, workspaces: 1, created: 0 });
    expect(emitted).toHaveLength(1);

    // Desligar a regra tira o workspace da listagem do tick.
    await setRule(onWs, 'off');
    const third = await runCopilotAutopilotTick(d);
    expect(third.workspaces).toBe(0);
  });

  it('Copiloto desligado no workspace: o tick não gera', async () => {
    await setRule(onWs, 'suggest');
    await getDb().insert(schema.copilotSettings).values({ workspaceId: onWs.ws, enabled: false });
    const out = await runCopilotAutopilotTick(deps(scopedPort()));
    expect(out.workspaces).toBe(0);
    await getDb()
      .delete(schema.copilotSettings)
      .where(eq(schema.copilotSettings.workspaceId, onWs.ws));
  });
});
