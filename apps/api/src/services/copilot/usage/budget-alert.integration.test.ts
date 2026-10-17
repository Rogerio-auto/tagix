/**
 * F73-S15 · alerta de orçamento contra o Postgres e o Redis de dev: dispara UMA vez por mês por
 * limiar (dois ticks), cobre o limiar de alerta e o do teto, só avisa OWNER, adia no silêncio,
 * reaproveita a trava estrutural do `eventKey` se o Redis for esvaziado e se recupera de falha.
 */
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import { loadConfig } from '../../../config';
import type { NotifiableEvent, NotifyOutcome } from '../../notifications';
import {
  BUDGET_ALERT_DONE_PREFIX,
  BUDGET_ALERT_LOCK_PREFIX,
  budgetAlertEventKey,
  createBudgetAlertDeps,
  crossedThresholds,
  runBudgetAlertTick,
  type BudgetAlertDeps,
} from './budget-alert';
import { seedUsageWorld, USAGE_NOW, type UsageWorld } from './test-fixtures';

let redis: Redis;
let world: UsageWorld;

beforeAll(async () => {
  redis = new Redis(loadConfig().redisUrl, { maxRetriesPerRequest: 1 });
  world = await seedUsageWorld();
});

afterAll(async () => {
  const keys = await redis.keys(`*copilot-budget-alert*${world.workspaceId}*`);
  const keys2 = await redis.keys(`${BUDGET_ALERT_DONE_PREFIX}:${world.workspaceId}:*`);
  if (keys.length + keys2.length > 0) await redis.del(...keys, ...keys2);
  await world.cleanup();
  await redis.quit();
  await closeDb();
});

async function clearMarks(): Promise<void> {
  const keys = [
    ...(await redis.keys(`${BUDGET_ALERT_DONE_PREFIX}:${world.workspaceId}:*`)),
    ...(await redis.keys(`${BUDGET_ALERT_LOCK_PREFIX}:${world.workspaceId}:*`)),
  ];
  if (keys.length > 0) await redis.del(...keys);
}

async function setBudget(monthlyUsd: string, alertPct = 80, enabled = true): Promise<void> {
  await getDb()
    .insert(schema.copilotSettings)
    .values({
      workspaceId: world.workspaceId,
      monthlyBudgetUsd: monthlyUsd,
      budgetAlertPct: alertPct,
      enabled,
    })
    .onConflictDoUpdate({
      target: schema.copilotSettings.workspaceId,
      set: { monthlyBudgetUsd: monthlyUsd, budgetAlertPct: alertPct, enabled },
    });
}

interface Recorder {
  readonly deps: BudgetAlertDeps;
  readonly sent: NotifiableEvent[];
  next: (event: NotifiableEvent) => Promise<NotifyOutcome>;
}

function recorder(): Recorder {
  const sent: NotifiableEvent[] = [];
  const rec: Recorder = {
    sent,
    next: async () => ({ entreguePor: 'push', suppressedBy: null }),
    deps: createBudgetAlertDeps({
      redis,
      now: () => USAGE_NOW,
      logger: createLogger('error', { svc: 'test' }),
      notify: async (event) => {
        sent.push(event);
        return rec.next(event);
      },
    }),
  };
  return rec;
}

const only = (): { workspaceIds: string[] } => ({ workspaceIds: [world.workspaceId] });

describe('crossedThresholds (puro)', () => {
  const c = { workspaceId: 'w', spentUsd: 0, capUsd: 30, alertPct: 80 };
  it('alerta e teto, sem repetir quando o alerta é 100', () => {
    expect(crossedThresholds({ ...c, spentUsd: 23.9 })).toEqual([]);
    expect(crossedThresholds({ ...c, spentUsd: 24 })).toEqual([80]);
    expect(crossedThresholds({ ...c, spentUsd: 30 })).toEqual([80, 100]);
    expect(crossedThresholds({ ...c, spentUsd: 31, alertPct: 100 })).toEqual([100]);
    expect(crossedThresholds({ ...c, spentUsd: 5, capUsd: 0 })).toEqual([]);
  });
});

describe('runBudgetAlertTick', () => {
  it('abaixo do limiar: nada sai (gasto US$ 2,50 de US$ 30)', async () => {
    await clearMarks();
    await setBudget('30.00');
    const r = recorder();
    const tick = await runBudgetAlertTick(r.deps, only());
    expect(tick).toMatchObject({ candidates: 0, notified: 0 });
    expect(r.sent).toHaveLength(0);
  });

  it('cruza 80%: um aviso ao OWNER; o segundo tick não repete', async () => {
    await clearMarks();
    await setBudget('3.00'); // 2,50 / 3,00 = 83%
    const r = recorder();

    const first = await runBudgetAlertTick(r.deps, only());
    expect(first).toMatchObject({ candidates: 1, notified: 1, alreadyDone: 0, errors: 0 });
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({
      workspaceId: world.workspaceId,
      memberId: world.members.OWNER.id,
      evento: 'copilot_aprovacao',
      eventKey: budgetAlertEventKey('2026-10', 80),
      titulo: 'O Copiloto já usou 80% do orçamento do mês',
      origem: 'Copiloto',
    });
    // Título sem valores em dinheiro (aparece na tela bloqueada).
    expect(r.sent[0]?.titulo).not.toMatch(/US\$|R\$|\d+,\d{2}/);

    const second = await runBudgetAlertTick(r.deps, only());
    expect(second).toMatchObject({ candidates: 1, notified: 0, alreadyDone: 1 });
    expect(r.sent).toHaveLength(1);
  });

  it('chegar ao teto avisa o limiar de 100% uma vez, sem repetir o de 80%', async () => {
    await clearMarks();
    await setBudget('2.00'); // 2,50 / 2,00 = 125%: cruzou 80% e 100%
    const r = recorder();
    const first = await runBudgetAlertTick(r.deps, only());
    expect(first.notified).toBe(2);
    expect(r.sent.map((e) => e.eventKey)).toEqual([
      budgetAlertEventKey('2026-10', 80),
      budgetAlertEventKey('2026-10', 100),
    ]);
    expect(r.sent[1]?.titulo).toBe('O Copiloto atingiu o orçamento do mês');
    const second = await runBudgetAlertTick(r.deps, only());
    expect(second).toMatchObject({ notified: 0, alreadyDone: 2 });
    expect(r.sent).toHaveLength(2);
  });

  it('Redis esvaziado: o eventKey é o mesmo, a cascata deduplica (mesma chave nos dois ticks)', async () => {
    await clearMarks();
    await setBudget('3.00');
    const r = recorder();
    await runBudgetAlertTick(r.deps, only());
    await clearMarks();
    await runBudgetAlertTick(r.deps, only());
    expect(r.sent).toHaveLength(2);
    expect(new Set(r.sent.map((e) => e.eventKey)).size).toBe(1);
  });

  it('silêncio do OWNER adia (sem marca) e a tentativa seguinte conclui', async () => {
    await clearMarks();
    await setBudget('3.00');
    const r = recorder();
    r.next = async () => ({ entreguePor: null, suppressedBy: 'silencio' });
    const first = await runBudgetAlertTick(r.deps, only());
    expect(first).toMatchObject({ notified: 1, deferred: 1 });

    r.next = async () => ({ entreguePor: 'push', suppressedBy: null });
    const second = await runBudgetAlertTick(r.deps, only());
    expect(second).toMatchObject({ notified: 1, deferred: 0 });
    const third = await runBudgetAlertTick(r.deps, only());
    expect(third).toMatchObject({ notified: 0, alreadyDone: 1 });
    expect(r.sent).toHaveLength(2);
  });

  it('envio que lança: conta o erro, não marca, e o tick seguinte tenta de novo', async () => {
    await clearMarks();
    await setBudget('3.00');
    const r = recorder();
    r.next = async () => {
      throw new Error('cascata fora do ar');
    };
    const first = await runBudgetAlertTick(r.deps, only());
    expect(first).toMatchObject({ errors: 1, alreadyDone: 0 });

    r.next = async () => ({ entreguePor: 'push', suppressedBy: null });
    const second = await runBudgetAlertTick(r.deps, only());
    expect(second).toMatchObject({ errors: 0, notified: 1 });
    expect(r.sent).toHaveLength(2);
  });

  it('só avisa OWNER ativo: ADMIN/AGENT nunca recebem; OWNER inativo é ignorado', async () => {
    await clearMarks();
    await setBudget('3.00');
    await getDb()
      .update(schema.members)
      .set({ status: 'inactive' })
      .where(eq(schema.members.id, world.members.OWNER.id));
    const r = recorder();
    const tick = await runBudgetAlertTick(r.deps, only());
    expect(r.sent).toHaveLength(0);
    // Sem destinatário nada é marcado: um OWNER que voltar a ficar ativo ainda recebe o aviso.
    expect(tick.errors).toBe(0);
    expect(await redis.exists(`${BUDGET_ALERT_DONE_PREFIX}:${world.workspaceId}:2026-10:80`)).toBe(
      0,
    );
    await getDb()
      .update(schema.members)
      .set({ status: 'active' })
      .where(eq(schema.members.id, world.members.OWNER.id));
  });

  it('Copiloto desligado no workspace: não avisa', async () => {
    await clearMarks();
    await setBudget('3.00', 80, false);
    const r = recorder();
    const tick = await runBudgetAlertTick(r.deps, only());
    expect(tick.candidates).toBe(0);
    expect(r.sent).toHaveLength(0);
    await setBudget('30.00', 80, true);
  });

  it('o gasto de setembro e o da superfície `agent` não contam para o limiar', async () => {
    await clearMarks();
    // Teto de US$ 6: com setembro (9,00) ou `agent` (5,00) somados passaria de 80%; só o
    // Copiloto de outubro (2,50 = 41%) conta.
    await setBudget('6.00');
    const r = recorder();
    const tick = await runBudgetAlertTick(r.deps, only());
    expect(tick.candidates).toBe(0);
    expect(r.sent).toHaveLength(0);
  });
});
