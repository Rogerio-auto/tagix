/**
 * Testes dos refresh jobs do dashboard (F8-S02). Lock skipping (puro) + tick real
 * contra o Postgres local (infra Docker UP): popula dashboard_snapshots e dá refresh
 * nas MVs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';

// @hm/workers não tem vitest setup global nem `dotenv` como dep; este teste de
// integração precisa do Postgres real (infra Docker UP). Carregamos DATABASE_URL do
// .env da raiz com um parser mínimo (getDb() lê process.env de forma lazy).
beforeAll(() => {
  if (process.env['DATABASE_URL']) return;
  const envPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../.env',
  );
  try {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!;
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // Sem .env → getDb() lança com mensagem clara; o teste falha de forma explícita.
  }
});
import { createLogger } from '@hm/logger';
import { runSnapshotTick } from './snapshot-job';
import { runMvRefreshTick } from './mv-refresh-job';
import type { RedisLike } from './scheduler';

const logger = createLogger('error');
const { workspaces, slaRules, dashboardSnapshots, plans } = schema;

function fakeRedis(setResult: 'OK' | null = 'OK'): RedisLike {
  return {
    set: vi.fn(async () => setResult),
    eval: vi.fn(async () => 1),
  };
}

afterAll(async () => {
  await closeDb();
});

describe('runSnapshotTick', () => {
  it('pula quando o lock é detido por outra instância', async () => {
    const res = await runSnapshotTick({ redis: fakeRedis(null), logger });
    expect(res.ran).toBe(false);
  });

  it('popula dashboard_snapshots para um workspace com regra de SLA', async () => {
    const db = getDb();
    const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
    const sfx = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(workspaces)
      .values({ name: `DashRefresh ${sfx}`, slug: `dashref-${sfx}`, planId: free?.id ?? null })
      .returning();
    if (!w) throw new Error('ws');
    try {
      await db
        .insert(slaRules)
        .values({ workspaceId: w.id, scopeType: 'workspace', firstResponseSecs: 300 });

      const res = await runSnapshotTick({ redis: fakeRedis(), logger });
      expect(res.ran).toBe(true);
      expect(res.snapshots).toBeGreaterThan(0);

      // O snapshot de sla_violado_hoje deve existir p/ o workspace (scope {}).
      const snaps = await withWorkspace(w.id, (tx) =>
        tx.select().from(dashboardSnapshots).where(eq(dashboardSnapshots.metricKey, 'sla_violado_hoje')),
      );
      expect(snaps.length).toBe(1);
      expect(snaps[0]?.value).toHaveProperty('count');

      // deals_fechados_ganho_mes também é gravado (scope {}).
      const won = await withWorkspace(w.id, (tx) =>
        tx
          .select()
          .from(dashboardSnapshots)
          .where(eq(dashboardSnapshots.metricKey, 'deals_fechados_ganho_mes')),
      );
      expect(won.length).toBe(1);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, w.id));
    }
  });
});

describe('runMvRefreshTick', () => {
  it('pula quando o lock é detido por outra instância', async () => {
    const res = await runMvRefreshTick({ redis: fakeRedis(null), logger });
    expect(res.ran).toBe(false);
  });

  it('dá REFRESH CONCURRENTLY nas 3 materialized views', async () => {
    const res = await runMvRefreshTick({ redis: fakeRedis(), logger });
    expect(res.ran).toBe(true);
    expect(res.refreshed).toBe(3);
  });
});
