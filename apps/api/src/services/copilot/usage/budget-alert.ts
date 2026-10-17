/**
 * Alerta de orçamento do Copiloto (F73-S15; COPILOTO.md P8, §5.6), no processo HTTP da API.
 *
 * A cada tick (5 min), para cada workspace cujo gasto do Copiloto no mês corrente (UTC, a mesma
 * janela do teto) já cruzou um limiar, avisa os OWNER ativos pela cascata de notificação:
 *
 *   limiar `alert`  `budget_alert_pct` do workspace (padrão 80 %)
 *   limiar `cap`    100 % do teto mensal. Aqui é SÓ o aviso: o `budget_mode` (queries_only/pause)
 *                   já é aplicado pelo S10 no próximo turno
 *
 * Garantias:
 * - uma vez por mês por limiar: a marca `done` no Redis (40 dias) pula o workspace nos ticks
 *   seguintes, e o `eventKey` (`copilot_budget:<AAAA-MM>:<limiar>`) é a segunda trava, estrutural,
 *   na cascata (índice único de `notification_deliveries`): um Redis esvaziado não gera aviso em
 *   dobro. Mudar o `budget_alert_pct` no meio do mês cria outro limiar, e portanto outro aviso;
 * - duas réplicas nunca processam o mesmo workspace/mês/limiar ao mesmo tempo (lock com token,
 *   o mesmo `acquireSweepLock` do varredor de propostas);
 * - a marca `done` só é gravada quando TODOS os OWNER têm desfecho final. O silêncio do membro
 *   (`silencio`) adia: o próximo tick tenta de novo. Se o envio LANÇAR, nada é marcado;
 * - o Copiloto desligado no workspace não avisa (não há gasto novo a vigiar).
 *
 * O evento usado é `copilot_aprovacao` (o `NotificationEvent` de `@hm/shared` ainda não tem um
 * `copilot_orcamento`; o pacote não é deste slot): quem silencia aprovações silencia este aviso.
 * O título leva só percentual; valores em US$ ficam no `/usage` (`copilot.view_costs`).
 */
import Redis from 'ioredis';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { COPILOT_SETTINGS_DEFAULTS, getDb, schema, withWorkspace } from '@hm/db';
import { createLogger, type Logger } from '@hm/logger';
import { loadConfig } from '../../../config';
import { notifyEvent, type NotifiableEvent, type NotifyOutcome } from '../../notifications';
import { monthStartUtc, nextMonthStartUtc } from '../identity/budget';
import { acquireSweepLock, type SweepRedis } from '../proposals/sweeper';
import { usageMonthKey } from './usage';

export const BUDGET_ALERT_LOCK_PREFIX = 'hm:lock:scheduler:copilot-budget-alert' as const;
export const BUDGET_ALERT_DONE_PREFIX = 'hm:copilot-budget-alert:done' as const;
export const BUDGET_ALERT_TICK_INTERVAL_MS = 5 * 60_000;
const BUDGET_ALERT_LOCK_TTL_MS = 2 * 60_000;
const BUDGET_ALERT_DONE_TTL_MS = 40 * 24 * 60 * 60_000;
const BUDGET_ALERT_INITIAL_DELAY_MS = 20_000;
/** Limiar do teto (100 % do orçamento mensal). */
export const BUDGET_CAP_PCT = 100;
/** Para onde o toque no aviso leva (seção do Copiloto nas configurações; COPILOTO.md §11). */
export const BUDGET_ALERT_URL = '/settings?s=copiloto';

/** O mínimo de Redis do agendador (ioredis real ou fake de teste). */
export interface BudgetAlertRedis extends SweepRedis {
  get(key: string): Promise<string | null>;
}

export type BudgetAlertNotifier = (event: NotifiableEvent) => Promise<NotifyOutcome>;

export interface BudgetAlertDeps {
  readonly now: () => Date;
  readonly redis: BudgetAlertRedis;
  readonly notify: BudgetAlertNotifier;
  readonly logger: Logger;
}

export interface BudgetAlertTickResult {
  /** Workspaces com gasto acima do limiar de alerta no mês. */
  readonly candidates: number;
  /** Avisos entregues à cascata (um por OWNER e limiar). */
  readonly notified: number;
  /** Limiares pulados porque já foram avisados neste mês. */
  readonly alreadyDone: number;
  /** Limiares em processamento por outra réplica. */
  readonly locked: number;
  /** Limiares adiados (silêncio do OWNER): o próximo tick tenta de novo. */
  readonly deferred: number;
  readonly errors: number;
}

interface MutableTick {
  candidates: number;
  notified: number;
  alreadyDone: number;
  locked: number;
  deferred: number;
  errors: number;
}

interface Candidate {
  readonly workspaceId: string;
  readonly spentUsd: number;
  readonly capUsd: number;
  readonly alertPct: number;
}

/** Desfechos finais da cascata: não adianta tentar de novo neste mês. */
function isFinalOutcome(outcome: NotifyOutcome): boolean {
  return outcome.entreguePor !== null || outcome.suppressedBy !== 'silencio';
}

/**
 * Workspaces com o Copiloto ligado cujo gasto do mês já passou do limiar de alerta. Roda no
 * papel owner, entre workspaces (uma consulta por tick; o índice de `llm_usage_logs` cobre
 * `workspace_id, surface, created_at`).
 */
async function listCandidates(
  now: Date,
  only: readonly string[] | undefined,
): Promise<Candidate[]> {
  const l = schema.llmUsageLogs;
  const s = schema.copilotSettings;
  const cap = sql`coalesce(${s.monthlyBudgetUsd}, ${COPILOT_SETTINGS_DEFAULTS.monthlyBudgetUsd}::numeric)`;
  const alert = sql`coalesce(${s.budgetAlertPct}, ${COPILOT_SETTINGS_DEFAULTS.budgetAlertPct})`;
  const spent = sql<string>`sum(${l.costUsd})`;
  const rows = await getDb()
    .select({
      workspaceId: l.workspaceId,
      spent,
      cap: sql<string>`${cap}`,
      alert: sql<number>`${alert}`,
    })
    .from(l)
    .leftJoin(s, eq(s.workspaceId, l.workspaceId))
    .where(
      and(
        eq(l.surface, 'copilot'),
        gte(l.createdAt, monthStartUtc(now)),
        lt(l.createdAt, nextMonthStartUtc(now)),
        sql`coalesce(${s.enabled}, true)`,
      ),
    )
    .groupBy(l.workspaceId, s.monthlyBudgetUsd, s.budgetAlertPct)
    .having(sql`${cap} > 0 and sum(${l.costUsd}) * 100 >= ${cap} * ${alert}`);
  const filter = only ? new Set(only) : null;
  return rows.flatMap((r): Candidate[] =>
    filter && !filter.has(r.workspaceId)
      ? []
      : [
          {
            workspaceId: r.workspaceId,
            spentUsd: Number(r.spent),
            capUsd: Number(r.cap),
            alertPct: Number(r.alert),
          },
        ],
  );
}

/** Limiares já cruzados (alerta e/ou teto), sem repetição, em ordem crescente. */
export function crossedThresholds(c: Candidate): number[] {
  const out = new Set<number>();
  for (const pct of [c.alertPct, BUDGET_CAP_PCT]) {
    if (c.capUsd > 0 && c.spentUsd * 100 >= c.capUsd * pct) out.add(pct);
  }
  return [...out].sort((a, b) => a - b);
}

export function budgetAlertEventKey(month: string, pct: number): string {
  return `copilot_budget:${month}:${pct}`;
}

function alertTitle(pct: number): string {
  return pct >= BUDGET_CAP_PCT
    ? 'O Copiloto atingiu o orçamento do mês'
    : `O Copiloto já usou ${pct}% do orçamento do mês`;
}

async function listOwners(workspaceId: string): Promise<string[]> {
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.workspaceId, workspaceId),
          eq(schema.members.role, 'OWNER'),
          eq(schema.members.status, 'active'),
        ),
      );
    return rows.map((r) => r.id);
  });
}

async function processThreshold(
  deps: BudgetAlertDeps,
  c: Candidate,
  month: string,
  pct: number,
  tick: MutableTick,
): Promise<void> {
  const doneKey = `${BUDGET_ALERT_DONE_PREFIX}:${c.workspaceId}:${month}:${pct}`;
  if ((await deps.redis.get(doneKey)) !== null) {
    tick.alreadyDone += 1;
    return;
  }
  const release = await acquireSweepLock(
    deps.redis,
    `${BUDGET_ALERT_LOCK_PREFIX}:${c.workspaceId}:${month}:${pct}`,
    BUDGET_ALERT_LOCK_TTL_MS,
  );
  if (!release) {
    tick.locked += 1;
    return;
  }
  try {
    // Outra réplica pode ter concluído entre a primeira leitura e o lock.
    if ((await deps.redis.get(doneKey)) !== null) {
      tick.alreadyDone += 1;
      return;
    }
    const owners = await listOwners(c.workspaceId);
    let settled = true;
    for (const ownerId of owners) {
      const outcome = await deps.notify({
        workspaceId: c.workspaceId,
        memberId: ownerId,
        evento: 'copilot_aprovacao',
        eventKey: budgetAlertEventKey(month, pct),
        titulo: alertTitle(pct),
        origem: 'Copiloto',
        url: BUDGET_ALERT_URL,
      });
      tick.notified += 1;
      if (!isFinalOutcome(outcome)) settled = false;
    }
    if (owners.length === 0) return;
    if (settled) {
      await deps.redis.set(doneKey, '1', 'PX', BUDGET_ALERT_DONE_TTL_MS, 'NX');
    } else {
      tick.deferred += 1;
    }
  } finally {
    await release().catch(() => undefined);
  }
}

export interface BudgetAlertTickOptions {
  /** Restringe a estes workspaces (testes). */
  readonly workspaceIds?: readonly string[];
}

/** Uma passada do agendador. */
export async function runBudgetAlertTick(
  deps: BudgetAlertDeps,
  options: BudgetAlertTickOptions = {},
): Promise<BudgetAlertTickResult> {
  const now = deps.now();
  const month = usageMonthKey(now);
  const tick: MutableTick = {
    candidates: 0,
    notified: 0,
    alreadyDone: 0,
    locked: 0,
    deferred: 0,
    errors: 0,
  };
  const candidates = await listCandidates(now, options.workspaceIds);
  tick.candidates = candidates.length;
  for (const c of candidates) {
    for (const pct of crossedThresholds(c)) {
      try {
        await processThreshold(deps, c, month, pct, tick);
      } catch (err) {
        tick.errors += 1;
        deps.logger.error('copilot-budget-alert: falha ao avisar', {
          ref: 'hm_copilot_budget_alert',
          workspaceId: c.workspaceId,
          threshold_pct: pct,
          errorName: err instanceof Error ? err.name : typeof err,
        });
      }
    }
  }
  if (tick.notified > 0) {
    deps.logger.info('copilot.budget_alert', { month, ...tick });
  }
  return tick;
}

export function createBudgetAlertDeps(
  overrides: Partial<BudgetAlertDeps> & { readonly redis: BudgetAlertRedis },
): BudgetAlertDeps {
  return {
    now: () => new Date(),
    notify: notifyEvent,
    logger: createLogger('info', { svc: '@hm/api', component: 'copilot-budget-alert' }),
    ...overrides,
  };
}

export interface BudgetAlertScheduler {
  /** Para o timer e espera a passada em andamento. */
  stop(): Promise<void>;
}

/**
 * Liga o agendador. Timers `unref` (não seguram o processo vivo); `stop()` no shutdown.
 * Sem `redis`, abre um cliente próprio (fechado no `stop`).
 */
export function startBudgetAlertScheduler(
  options: {
    readonly intervalMs?: number;
    readonly redis?: BudgetAlertRedis;
    readonly deps?: Partial<BudgetAlertDeps>;
  } = {},
): BudgetAlertScheduler {
  const ownRedis = options.redis
    ? null
    : new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const redis: BudgetAlertRedis = options.redis ?? (ownRedis as Redis);
  const deps = createBudgetAlertDeps({ ...options.deps, redis });
  let running: Promise<unknown> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || running) return;
    running = runBudgetAlertTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('copilot-budget-alert: passada falhou', {
          ref: 'hm_copilot_budget_alert_tick',
          errorName: err instanceof Error ? err.name : typeof err,
        });
      })
      .finally(() => {
        running = null;
      });
  };

  const timer = setInterval(tick, options.intervalMs ?? BUDGET_ALERT_TICK_INTERVAL_MS);
  timer.unref();
  const first = setTimeout(tick, BUDGET_ALERT_INITIAL_DELAY_MS);
  first.unref();

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
      if (running) await running;
      if (ownRedis) await ownRedis.quit().catch(() => undefined);
    },
  };
}
