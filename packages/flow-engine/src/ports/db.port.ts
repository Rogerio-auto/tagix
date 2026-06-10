/**
 * Implementacao real do FlowDbPort sobre @hm/db (Drizzle) com RLS por workspace.
 *
 * createExecution resolve a flow_version CORRENTE (maior `version`) do flow ativo e
 * persiste flow_executions referenciando-a (FLOW_BUILDER.md secao 7: execucao referencia
 * a version, nao o flow). loadExecution junta execution + version para materializar
 * nodes/edges do snapshot publicado.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import type {
  ExecutionPatch,
  FlowDbPort,
  FlowLogEntry,
  LoadedExecution,
  TriggerFlowDbInput,
} from '../deps';
import type { FlowEdge, FlowNode } from '../types';

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

async function patchExecution(
  workspaceId: string,
  executionId: string,
  patch: ExecutionPatch,
): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set['status'] = patch.status;
    if (patch.currentNodeId !== undefined) set['currentNodeId'] = patch.currentNodeId;
    if (patch.variables !== undefined) set['variables'] = patch.variables;
    if (patch.nextStepAt !== undefined) set['nextStepAt'] = patch.nextStepAt;
    if (patch.lastError !== undefined) set['lastError'] = patch.lastError;
    if (patch.completedAt !== undefined) set['completedAt'] = patch.completedAt;
    await tx.update(flowExecutions).set(set).where(eq(flowExecutions.id, executionId));
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
        inArray(flowExecutions.status, ['running', 'waiting']),
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
  patchExecution,
  insertLog,
  findActiveByConversation,
};
