/**
 * Portão de assinatura das automações de saída (F71-S06, CONTAS_E_CONVITES §3.4, T7).
 *
 * Empresa com assinatura `expired`/`canceled` (ou `trial` com `trial_ends_at` já passado)
 * NÃO dispara nada para fora: turno do agente IA, passo de flow, disparo e follow-up de
 * campanha, lembrete de agenda ao contato e ação de vencimento. O job conclui como
 * {@link SKIPPED_SUBSCRIPTION_INACTIVE}, sem retry e sem enviar. O INBOUND não passa por
 * aqui: mensagem que chega é sempre gravada (sem perda de dado).
 *
 * **Leitura no momento do job, sem cache entre jobs.** Uma consulta por chave primária em
 * `workspaces` (sub-milissegundo, índice da PK) por job — o volume dos workers de saída é
 * dominado por chamadas de LLM, envio ao provedor e transações de várias consultas; um
 * cache com TTL economizaria ruído e criaria a janela em que uma empresa que acabou de
 * pagar continua parada (ou, pior, uma que acabou de expirar continua enviando). Nos
 * ticks que varrem muitos itens da mesma empresa, {@link memoizeSubscriptionGate} reduz a
 * uma consulta por empresa POR TICK — a decisão continua sendo do banco, no tick.
 *
 * A regra de status é a mesma da guarda da API (`apps/api/src/middlewares/subscription-guard.ts`):
 * `workspaces.subscription_status`, com trial vencido valendo `expired` mesmo antes do
 * worker de cobrança gravar a transição.
 *
 * Empresa inexistente → inativa (fail-closed): não há como provar que pode enviar.
 */
import { Counter } from 'prom-client';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import type { Logger } from '@hm/logger';
import { getWorkersMetricsRegistry } from '../observability/metrics';

/** Desfecho canônico do job pulado (log, métrica, motivo gravado). */
export const SKIPPED_SUBSCRIPTION_INACTIVE = 'skipped_subscription_inactive' as const;

/** Status que deixam a empresa só leitura. */
const INACTIVE_STATUSES: ReadonlySet<string> = new Set(['expired', 'canceled']);

/** Status efetivo: `trial` com `trial_ends_at <= now` é `expired`. */
export function effectiveSubscriptionStatus(
  status: string,
  trialEndsAt: Date | null,
  now: Date,
): string {
  if (status === 'trial' && trialEndsAt !== null && trialEndsAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return status;
}

export type SubscriptionGateDecision =
  | { readonly active: true; readonly status: string }
  | { readonly active: false; readonly status: string };

/** Decide se a empresa pode disparar automações de saída AGORA. */
export interface SubscriptionGate {
  check(workspaceId: string): Promise<SubscriptionGateDecision>;
}

/** Linha mínima lida do banco. */
export interface WorkspaceSubscriptionRow {
  readonly subscriptionStatus: string;
  readonly trialEndsAt: Date | null;
}

export type LoadWorkspaceSubscription = (
  workspaceId: string,
) => Promise<WorkspaceSubscriptionRow | null>;

/**
 * Leitura real: PK de `workspaces`. Owner-level (`getDb()`), como os enumeradores dos
 * schedulers: é a linha da PRÓPRIA empresa do job, identificada pelo envelope/tick.
 */
export const loadWorkspaceSubscription: LoadWorkspaceSubscription = async (workspaceId) => {
  const { workspaces } = schema;
  const [row] = await getDb()
    .select({
      subscriptionStatus: workspaces.subscriptionStatus,
      trialEndsAt: workspaces.trialEndsAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
};

export interface SubscriptionGateOptions {
  readonly load?: LoadWorkspaceSubscription;
  readonly now?: () => Date;
}

/** Portão que lê o banco a cada `check` (sem cache). */
export function createSubscriptionGate(options: SubscriptionGateOptions = {}): SubscriptionGate {
  const load = options.load ?? loadWorkspaceSubscription;
  const now = options.now ?? (() => new Date());
  return {
    async check(workspaceId) {
      const row = await load(workspaceId);
      if (row === null) return { active: false, status: 'not_found' };
      const status = effectiveSubscriptionStatus(row.subscriptionStatus, row.trialEndsAt, now());
      return INACTIVE_STATUSES.has(status) ? { active: false, status } : { active: true, status };
    },
  };
}

/**
 * Memoiza as decisões por empresa durante UMA varredura (tick). Crie um novo a cada tick:
 * nada sobrevive entre ticks. Falha de leitura não é memoizada (o próximo item tenta de novo).
 */
export function memoizeSubscriptionGate(gate: SubscriptionGate): SubscriptionGate {
  const seen = new Map<string, Promise<SubscriptionGateDecision>>();
  return {
    check(workspaceId) {
      const cached = seen.get(workspaceId);
      if (cached !== undefined) return cached;
      const pending = gate.check(workspaceId);
      seen.set(workspaceId, pending);
      void pending.catch(() => seen.delete(workspaceId));
      return pending;
    },
  };
}

/** Portão permissivo — SÓ para teste (o nome diz isso). */
export const allowAllSubscriptionGate: SubscriptionGate = {
  check: async () => ({ active: true, status: 'active' }),
};

/** Portão default do processo (lê o banco a cada job). */
export const subscriptionGate: SubscriptionGate = createSubscriptionGate();

// ─── Observabilidade ─────────────────────────────────────────────────────────

/**
 * Jobs de saída pulados por assinatura inativa. Rótulos de cardinalidade fechada:
 * `worker` (conjunto fixo de nomes abaixo) e `status` (expired/canceled/not_found).
 */
const skippedTotal = new Counter({
  name: 'hm_worker_subscription_inactive_skipped_total',
  help: 'Jobs de automação de saída pulados porque a assinatura da empresa está inativa.',
  labelNames: ['worker', 'status'] as const,
  registers: [getWorkersMetricsRegistry()],
});

export type GatedWorker =
  | 'agent-run'
  | 'agent-followup'
  | 'agent-reengagement'
  | 'campaign-tick'
  | 'campaign-followup'
  | 'flow-step'
  | 'calendar-reminder'
  | 'outbound';

/** Registra (métrica + log) um job concluído como {@link SKIPPED_SUBSCRIPTION_INACTIVE}. */
export function recordSubscriptionSkip(
  logger: Logger,
  worker: GatedWorker,
  workspaceId: string,
  status: string,
  context: Record<string, unknown> = {},
): void {
  skippedTotal.inc({ worker, status });
  logger.info(`${worker}: assinatura inativa — nada é enviado`, {
    outcome: SKIPPED_SUBSCRIPTION_INACTIVE,
    workspaceId,
    subscriptionStatus: status,
    ...context,
  });
}
