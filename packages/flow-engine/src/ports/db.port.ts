/**
 * Implementacao real do FlowDbPort sobre @hm/db (Drizzle) com RLS por workspace.
 *
 * createExecution resolve a flow_version CORRENTE (maior `version`) do flow ativo e
 * persiste flow_executions referenciando-a (FLOW_BUILDER.md secao 7: execucao referencia
 * a version, nao o flow). loadExecution junta execution + version para materializar
 * nodes/edges do snapshot publicado.
 *
 * F56-S13 (INF-04): `claimExecution` substitui o read-then-act do dispatcher por um
 * UPDATE condicional atomico (status → `processing` + step_count++); `patchExecution`
 * ganha fencing opcional (`expectStatus`) para o patch final do step so aplicar se o
 * claim ainda for nosso.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import type {
  ExecutionPatch,
  FlowClaimResult,
  FlowDbPort,
  FlowLogEntry,
  LoadedExecution,
  PatchExecutionOptions,
  TriggerFlowDbInput,
} from '../deps';
import type { FlowEdge, FlowNode } from '../types';

/**
 * Lease do claim (INF-04): um step reivindicado (`processing`) pertence ao consumer por
 * este intervalo; expirado, outro envelope pode fazer takeover (recuperacao pos-crash).
 * Deve exceder o pior step legitimo: pre-acao de message clampada em 30s
 * (MESSAGE_PRE_ACTION_MAX_MS) + envio + HTTP externo. 120s da 4x de folga.
 */
export const FLOW_CLAIM_LEASE_MS = 120_000;

const CLAIM_LEASE_SQL = sql.raw(`interval '${FLOW_CLAIM_LEASE_MS / 1000} seconds'`);

const { flows, flowVersions, flowExecutions, flowLogs } = schema;

function asNodes(value: unknown): FlowNode[] {
  return Array.isArray(value) ? (value as FlowNode[]) : [];
}
function asEdges(value: unknown): FlowEdge[] {
  return Array.isArray(value) ? (value as FlowEdge[]) : [];
}
function asVars(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function createExecution(input: TriggerFlowDbInput): Promise<{ executionId: string }> {
  return withWorkspace(input.workspaceId, async (tx) => {
    const [flow] = await tx.select().from(flows).where(eq(flows.id, input.flowId));
    if (!flow) throw new Error('flow nao encontrado: ' + input.flowId);

    const [version] = await tx
      .select()
      .from(flowVersions)
      .where(eq(flowVersions.flowId, input.flowId))
      .orderBy(desc(flowVersions.version))
      .limit(1);
    if (!version) throw new Error('flow sem version publicada: ' + input.flowId);

    const nodes = asNodes(version.nodes);
    const trigger = nodes.find((n) => n.type === 'trigger') ?? nodes[0];

    const [row] = await tx
      .insert(flowExecutions)
      .values({
        workspaceId: input.workspaceId,
        flowId: input.flowId,
        flowVersionId: version.id,
        conversationId: input.conversationId ?? null,
        contactId: input.contactId ?? null,
        triggeredBy: input.triggeredBy,
        triggeredByMemberId: input.triggeredByMemberId ?? null,
        status: 'running',
        currentNodeId: trigger?.id ?? null,
        variables: input.variables,
      })
      .returning({ id: flowExecutions.id });
    if (!row) throw new Error('falha ao criar flow_execution');
    return { executionId: row.id };
  });
}

function materialize(
  execRow: typeof flowExecutions.$inferSelect,
  versionRow: typeof flowVersions.$inferSelect,
): LoadedExecution {
  return {
    executionId: execRow.id,
    workspaceId: execRow.workspaceId,
    flowId: execRow.flowId,
    flowVersionId: execRow.flowVersionId,
    conversationId: execRow.conversationId,
    contactId: execRow.contactId,
    status: execRow.status as LoadedExecution['status'],
    currentNodeId: execRow.currentNodeId,
    stepCount: execRow.stepCount,
    variables: asVars(execRow.variables),
    nodes: asNodes(versionRow.nodes),
    edges: asEdges(versionRow.edges),
  };
}

async function loadExecution(
  workspaceId: string,
  executionId: string,
): Promise<LoadedExecution | null> {
  return withWorkspace(workspaceId, async (tx) => {
    const [execRow] = await tx
      .select()
      .from(flowExecutions)
      .where(eq(flowExecutions.id, executionId));
    if (!execRow) return null;
    const [versionRow] = await tx
      .select()
      .from(flowVersions)
      .where(eq(flowVersions.id, execRow.flowVersionId));
    if (!versionRow) return null;
    return materialize(execRow, versionRow);
  });
}

async function loadExecutionByIdOnly(executionId: string): Promise<LoadedExecution | null> {
  // Entrypoint sem escopo: resolve o workspace pelo owner (bypass RLS) e delega ao scoped.
  const [execRow] = await getDb()
    .select({ workspaceId: flowExecutions.workspaceId })
    .from(flowExecutions)
    .where(eq(flowExecutions.id, executionId));
  if (!execRow) return null;
  return loadExecution(execRow.workspaceId, executionId);
}

/**
 * Claim atomico de um step (INF-04). UM UPDATE condicional decide quem processa:
 *
 *   running                          → continuar (envelope de continuacao/redelivery);
 *   waiting com next_step_at vencido → wakeup do scheduler no prazo;
 *   processing com lease expirado    → takeover (o consumer anterior morreu no meio).
 *
 * `waiting` ANTES do prazo NAO e reivindicavel: um envelope duplicado/prematuro nao pode
 * disparar timeout antecipado de wait/wait_for_response — o scheduler acorda a execucao
 * na hora certa. `step_count` incrementa junto (mesmo write) para o teto anti-loop (INF-05).
 * Relogio unico: TODAS as comparacoes usam now() do Postgres (sem skew de app).
 */
async function claimExecution(workspaceId: string, executionId: string): Promise<FlowClaimResult> {
  return withWorkspace(workspaceId, async (tx) => {
    const [claimed] = await tx
      .update(flowExecutions)
      .set({
        status: 'processing',
        stepCount: sql`${flowExecutions.stepCount} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(flowExecutions.id, executionId),
          or(
            eq(flowExecutions.status, 'running'),
            and(
              eq(flowExecutions.status, 'waiting'),
              sql`(${flowExecutions.nextStepAt} is null or ${flowExecutions.nextStepAt} <= now())`,
            ),
            and(
              eq(flowExecutions.status, 'processing'),
              sql`${flowExecutions.updatedAt} < now() - ${CLAIM_LEASE_SQL}`,
            ),
          ),
        ),
      )
      .returning();

    if (claimed) {
      const [versionRow] = await tx
        .select()
        .from(flowVersions)
        .where(eq(flowVersions.id, claimed.flowVersionId));
      // Version deletada sob a execucao (RESTRICT deveria impedir): trata como inexistente.
      if (!versionRow) return { claimed: false, reason: 'not_found' };
      return { claimed: true, execution: materialize(claimed, versionRow) };
    }

    // Nao reivindicou: SELECT diagnostico decide o destino do envelope (drop vs retry).
    const [row] = await tx
      .select({ status: flowExecutions.status })
      .from(flowExecutions)
      .where(eq(flowExecutions.id, executionId));
    if (!row) return { claimed: false, reason: 'not_found' };
    if (row.status === 'processing') return { claimed: false, reason: 'in_flight' };
    if (row.status === 'waiting') return { claimed: false, reason: 'not_due' };
    return { claimed: false, reason: 'terminal' };
  });
}

async function claimExecutionByIdOnly(executionId: string): Promise<FlowClaimResult> {
  // Entrypoint sem escopo: resolve o workspace pelo owner (bypass RLS) e delega ao scoped.
  const [execRow] = await getDb()
    .select({ workspaceId: flowExecutions.workspaceId })
    .from(flowExecutions)
    .where(eq(flowExecutions.id, executionId));
  if (!execRow) return { claimed: false, reason: 'not_found' };
  return claimExecution(execRow.workspaceId, executionId);
}

async function patchExecution(
  workspaceId: string,
  executionId: string,
  patch: ExecutionPatch,
  options?: PatchExecutionOptions,
): Promise<boolean> {
  return withWorkspace(workspaceId, async (tx) => {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set['status'] = patch.status;
    if (patch.currentNodeId !== undefined) set['currentNodeId'] = patch.currentNodeId;
    if (patch.variables !== undefined) set['variables'] = patch.variables;
    if (patch.nextStepAt !== undefined) set['nextStepAt'] = patch.nextStepAt;
    if (patch.lastError !== undefined) set['lastError'] = patch.lastError;
    if (patch.completedAt !== undefined) set['completedAt'] = patch.completedAt;
    const expect = options?.expectStatus;
    const where =
      expect !== undefined
        ? // Fencing (INF-04): compare-and-set — so aplica se o status atual for o esperado.
          and(eq(flowExecutions.id, executionId), inArray(flowExecutions.status, [...expect]))
        : eq(flowExecutions.id, executionId);
    const rows = await tx
      .update(flowExecutions)
      .set(set)
      .where(where)
      .returning({ id: flowExecutions.id });
    return rows.length > 0;
  });
}

async function insertLog(entry: FlowLogEntry): Promise<void> {
  await withWorkspace(entry.workspaceId, async (tx) => {
    await tx.insert(flowLogs).values({
      workspaceId: entry.workspaceId,
      executionId: entry.executionId,
      nodeId: entry.nodeId,
      nodeType: entry.nodeType,
      level: entry.level,
      message: entry.message,
      payload: entry.payload ?? null,
    });
  });
}

async function findActiveByConversation(conversationId: string): Promise<LoadedExecution[]> {
  // Sem workspace conhecido: resolve via owner (bypass RLS) e materializa por execucao.
  const rows = await getDb()
    .select()
    .from(flowExecutions)
    .where(
      and(
        eq(flowExecutions.conversationId, conversationId),
        // `processing` incluso (F56-S13): cancelAll deve alcancar steps em voo — o patch
        // fenced do step perdedor nao ressuscita a execucao cancelada.
        inArray(flowExecutions.status, ['running', 'waiting', 'processing']),
      ),
    );
  const result: LoadedExecution[] = [];
  for (const execRow of rows) {
    const [versionRow] = await getDb()
      .select()
      .from(flowVersions)
      .where(eq(flowVersions.id, execRow.flowVersionId));
    if (versionRow) result.push(materialize(execRow, versionRow));
  }
  return result;
}

export const flowDbPort: FlowDbPort = {
  createExecution,
  loadExecution,
  loadExecutionByIdOnly,
  claimExecution,
  claimExecutionByIdOnly,
  patchExecution,
  insertLog,
  findActiveByConversation,
};
