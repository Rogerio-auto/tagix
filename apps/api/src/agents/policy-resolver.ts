/**
 * Policy resolver (F2-S09, AGENTS_LANGGRAPH §3.1/§8.1, DATA_MODEL §7).
 *
 * Resolve, no Node e antes de qualquer chamada ao `agent-runtime`, a policy de
 * IA efetiva de um workspace a partir de `workspace_agent_policies` (1:1 com o
 * workspace) e a transforma no `PolicySnapshot` que viaja em todo request
 * `POST /run` — o contrato load-bearing espelhado em
 * `@hm/agents-client` (`PolicySnapshotSchema`, snake_case no wire) e reaplicado
 * defensivamente pelo runtime Python (defense-in-depth, §8.2).
 *
 * Responsabilidades:
 *  - `loadWorkspacePolicy(workspaceId)` — lê a linha de policy sob RLS. Se o
 *    workspace ainda não tem linha (provisionamento tardio), aplica os defaults
 *    do schema (`POLICY_DEFAULTS`), espelhando os `default()` de
 *    `workspace_agent_policies` para nunca deixar o runtime sem policy.
 *  - `monthToDateSpendUsd(workspaceId)` — soma `llm_usage_logs.cost_usd` do mês
 *    corrente (UTC) sob RLS; é a base do hard cap de custo (vide `cost-guard`).
 *  - `resolvePolicy(workspaceId, agentId?)` — orquestra os dois acima e monta o
 *    `PolicySnapshot`. `remaining_monthly_budget_usd = null` quando não há cap
 *    (`max_monthly_cost_usd IS NULL`); caso contrário, `cap - gasto`, nunca
 *    negativo (o runtime exige `>= 0`).
 *
 * **Consumo:** este snapshot é injetado por F2-S11 (worker dispatch) no
 * `AgentRunRequest.policy_snapshot` via `@hm/agents-client`. O `cost-guard`
 * (mesmo slot) decide allow/deny pré-chamada a partir do `ResolvedPolicy` aqui
 * produzido. O CRUD de policy (F2-S16) escreve a linha; este módulo só lê.
 *
 * Não importa `@hm/agents-client` em runtime (não é dependência de `@hm/api`):
 * o snapshot é tipado estruturalmente por `PolicySnapshot` abaixo, mantido em
 * paridade byte-a-byte com `PolicySnapshotSchema`. A paridade é coberta por
 * teste de contrato no slot do cliente (S05).
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';

/**
 * Snapshot de policy resolvido pelo Node (snake_case — wire Pydantic/Zod).
 * Paridade estrutural com `PolicySnapshotSchema` de `@hm/agents-client`.
 * `remaining_monthly_budget_usd = null` significa "sem cap".
 */
export interface PolicySnapshot {
  readonly allowed_models: string[];
  readonly allow_streaming: boolean;
  readonly allow_interrupts: boolean;
  readonly allow_parallel_tools: boolean;
  readonly allow_vision: boolean;
  readonly allow_transcription: boolean;
  readonly max_iterations: number;
  readonly max_tokens_per_call: number;
  readonly max_tools_per_agent: number;
  readonly allowed_tool_categories: string[];
  readonly remaining_monthly_budget_usd: number | null;
}

/**
 * Policy do workspace já normalizada (numéricos como `number`, cap como
 * `number | null`). Forma interna do Node; o `PolicySnapshot` é a projeção wire.
 */
export interface WorkspacePolicy {
  readonly workspaceId: string;
  readonly allowedModels: string[];
  readonly defaultChatModel: string | null;
  readonly allowStreaming: boolean;
  readonly allowInterrupts: boolean;
  readonly allowParallelTools: boolean;
  readonly allowVision: boolean;
  readonly allowTranscription: boolean;
  readonly allowAgentConversions: boolean;
  readonly agentConversionRequireApproval: boolean;
  readonly maxIterations: number;
  readonly maxToolsPerAgent: number;
  readonly maxTokensPerCall: number;
  /** `null` = sem cap mensal de custo. */
  readonly maxMonthlyCostUsd: number | null;
  /** `null` = sem cap diário de invocações. */
  readonly maxDailyInvocations: number | null;
  readonly allowedToolCategories: string[];
}

/** Policy resolvida + estado de custo do mês — entrada do `cost-guard`. */
export interface ResolvedPolicy {
  readonly workspaceId: string;
  readonly policy: WorkspacePolicy;
  /** Gasto acumulado do mês corrente (UTC), em USD. */
  readonly monthToDateSpendUsd: number;
  /** Snapshot pronto para `AgentRunRequest.policy_snapshot`. */
  readonly snapshot: PolicySnapshot;
}

/**
 * Defaults espelhados de `workspace_agent_policies` (os `.default()` do schema).
 * Aplicados quando o workspace ainda não tem linha de policy, para o resolver
 * nunca devolver `null` ao caminho de dispatch.
 */
export const POLICY_DEFAULTS: Omit<WorkspacePolicy, 'workspaceId'> = {
  allowedModels: [],
  defaultChatModel: null,
  allowStreaming: true,
  allowInterrupts: false,
  allowParallelTools: true,
  allowVision: false,
  allowTranscription: false,
  allowAgentConversions: false,
  agentConversionRequireApproval: true,
  maxIterations: 5,
  maxToolsPerAgent: 20,
  maxTokensPerCall: 8000,
  maxMonthlyCostUsd: null,
  maxDailyInvocations: null,
  allowedToolCategories: ['database', 'workflow', 'calendar', 'knowledge'],
};

/** Converte um `numeric` Postgres (string|null) para `number | null`. */
function numericToNullableNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Primeiro instante do mês corrente em UTC (limite inferior da janela de gasto). */
export function monthStartUtc(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** Primeiro instante do próximo mês em UTC (limite superior exclusivo). */
export function nextMonthStartUtc(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

/** Mapeia a linha do schema para a forma normalizada do Node. */
function rowToPolicy(row: typeof schema.workspaceAgentPolicies.$inferSelect): WorkspacePolicy {
  return {
    workspaceId: row.workspaceId,
    allowedModels: row.allowedModels,
    defaultChatModel: row.defaultChatModel,
    allowStreaming: row.allowStreaming,
    allowInterrupts: row.allowInterrupts,
    allowParallelTools: row.allowParallelTools,
    allowVision: row.allowVision,
    allowTranscription: row.allowTranscription,
    allowAgentConversions: row.allowAgentConversions,
    agentConversionRequireApproval: row.agentConversionRequireApproval,
    maxIterations: row.maxIterations,
    maxToolsPerAgent: row.maxToolsPerAgent,
    maxTokensPerCall: row.maxTokensPerCall,
    maxMonthlyCostUsd: numericToNullableNumber(row.maxMonthlyCostUsd),
    maxDailyInvocations: row.maxDailyInvocations,
    allowedToolCategories: row.allowedToolCategories,
  };
}

/**
 * Lê a policy do workspace sob RLS. Se o workspace ainda não tem linha em
 * `workspace_agent_policies` (provisionamento tardio), devolve os defaults do
 * schema escopados ao `workspaceId`.
 *
 * Aceita um `tx` opcional para compor com outras leituras na mesma transação
 * RLS; sem ele, abre um `withWorkspace` próprio.
 */
export async function loadWorkspacePolicy(
  workspaceId: string,
  tx?: DbTx,
): Promise<WorkspacePolicy> {
  const read = async (t: DbTx): Promise<WorkspacePolicy> => {
    const [row] = await t
      .select()
      .from(schema.workspaceAgentPolicies)
      .where(eq(schema.workspaceAgentPolicies.workspaceId, workspaceId))
      .limit(1);
    return row ? rowToPolicy(row) : { workspaceId, ...POLICY_DEFAULTS };
  };
  return tx ? read(tx) : withWorkspace(workspaceId, read);
}

/**
 * Soma `llm_usage_logs.cost_usd` do mês corrente (UTC) para o workspace, sob RLS.
 * Inclui toda chamada LLM da janela — chat de agente, embeddings, vision,
 * transcription — porque o cap é de custo total do workspace, não por agente.
 *
 * Aceita um `tx` opcional (composição na mesma transação RLS do `loadWorkspacePolicy`).
 */
export async function monthToDateSpendUsd(
  workspaceId: string,
  at: Date = new Date(),
  tx?: DbTx,
): Promise<number> {
  const start = monthStartUtc(at);
  const end = nextMonthStartUtc(at);
  const run = async (t: DbTx): Promise<number> => {
    const rows = await t
      .select({
        spendUsd: sql<string | null>`coalesce(sum(${schema.llmUsageLogs.costUsd}), 0)`,
      })
      .from(schema.llmUsageLogs)
      .where(
        and(
          gte(schema.llmUsageLogs.createdAt, start),
          lt(schema.llmUsageLogs.createdAt, end),
        ),
      );
    return Number(rows[0]?.spendUsd ?? '0');
  };
  return tx ? run(tx) : withWorkspace(workspaceId, run);
}

/**
 * Constrói o `PolicySnapshot` (wire) a partir da policy normalizada e do gasto
 * do mês. `remaining_monthly_budget_usd = null` quando não há cap; senão
 * `max(cap - gasto, 0)` (o runtime exige `>= 0`).
 */
export function buildSnapshot(policy: WorkspacePolicy, monthToDateSpend: number): PolicySnapshot {
  const remaining =
    policy.maxMonthlyCostUsd === null
      ? null
      : Math.max(policy.maxMonthlyCostUsd - monthToDateSpend, 0);
  return {
    allowed_models: policy.allowedModels,
    allow_streaming: policy.allowStreaming,
    allow_interrupts: policy.allowInterrupts,
    allow_parallel_tools: policy.allowParallelTools,
    allow_vision: policy.allowVision,
    allow_transcription: policy.allowTranscription,
    max_iterations: policy.maxIterations,
    max_tokens_per_call: policy.maxTokensPerCall,
    max_tools_per_agent: policy.maxToolsPerAgent,
    allowed_tool_categories: policy.allowedToolCategories,
    remaining_monthly_budget_usd: remaining,
  };
}

/**
 * Resolve a policy efetiva do workspace e o estado de custo do mês, e monta o
 * `PolicySnapshot`. Uma única transação RLS cobre policy + gasto (consistência
 * de leitura e menos round-trips).
 *
 * `agentId` é aceito para futura resolução por-agente (override de modelo/tools);
 * no MVP a policy é 1:1 com o workspace, então o parâmetro é informativo — o
 * snapshot resultante é idêntico com ou sem ele. Mantido na assinatura para os
 * call sites de S11/S16 não mudarem quando a granularidade por-agente entrar.
 */
export async function resolvePolicy(
  workspaceId: string,
  _agentId?: string,
  at: Date = new Date(),
): Promise<ResolvedPolicy> {
  return withWorkspace(workspaceId, async (tx) => {
    const policy = await loadWorkspacePolicy(workspaceId, tx);
    const spend = await monthToDateSpendUsd(workspaceId, at, tx);
    return {
      workspaceId,
      policy,
      monthToDateSpendUsd: spend,
      snapshot: buildSnapshot(policy, spend),
    };
  });
}
