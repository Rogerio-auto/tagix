/**
 * Implementação real do `BackupDbPort` (F50-S03) sob RLS. Recebe um `DbTx` já escopado ao
 * workspace (via `req.scoped` na rota S04) — toda query é automaticamente isolada por tenant.
 * O isolamento garante que a resolução de referências NUNCA alcança recurso de outro workspace.
 */
import { eq, inArray } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import type { ReferenceIndex, RefOccurrence } from '@hm/flow-engine';
import { stageLookupKey, type BackupDbPort, type NewFlowRow, type RawFlowRow, type TargetLookups } from './ports';

const { flows, tags, stages, pipelines, agents, channels, members, conversionTypes } = schema;

/** Coleta valores únicos das ocorrências de um kind. */
function valuesOf(occ: readonly RefOccurrence[], kind: RefOccurrence['kind']): string[] {
  return [...new Set(occ.filter((o) => o.kind === kind).map((o) => o.value))];
}

export interface BackupAuthContext {
  readonly workspaceId: string;
  readonly memberId: string | null;
}

export function createBackupDbPort(tx: DbTx, ctx: BackupAuthContext): BackupDbPort {
  return {
    async listFlows(flowIds) {
      const base = tx
        .select({
          id: flows.id,
          name: flows.name,
          description: flows.description,
          triggerType: flows.triggerType,
          triggerConfig: flows.triggerConfig,
          filterStatus: flows.filterStatus,
          filterStageIds: flows.filterStageIds,
          filterTagIds: flows.filterTagIds,
          channelIds: flows.channelIds,
          nodes: flows.nodes,
          edges: flows.edges,
          schemaVersion: flows.schemaVersion,
        })
        .from(flows);
      const rows =
        flowIds && flowIds.length > 0
          ? await base.where(inArray(flows.id, [...flowIds])).orderBy(flows.createdAt)
          : await base.orderBy(flows.createdAt);
      return rows.map(
        (r): RawFlowRow => ({
          id: r.id,
          name: r.name,
          description: r.description,
          triggerType: r.triggerType,
          triggerConfig: r.triggerConfig ?? {},
          filterStatus: r.filterStatus ?? null,
          filterStageIds: r.filterStageIds ?? null,
          filterTagIds: r.filterTagIds ?? null,
          channelIds: r.channelIds ?? null,
          nodes: r.nodes ?? [],
          edges: r.edges ?? [],
          schemaVersion: r.schemaVersion,
        }),
      );
    },

    async describeReferences(occ): Promise<ReferenceIndex> {
      const tagIds = valuesOf(occ, 'tag');
      const stageIds = valuesOf(occ, 'stage');
      const pipelineIds = valuesOf(occ, 'pipeline');
      const agentIds = valuesOf(occ, 'agent');
      const channelIds = valuesOf(occ, 'channel');
      const memberIds = valuesOf(occ, 'member');
      const flowIds = valuesOf(occ, 'flow');
      const convKeys = valuesOf(occ, 'conversionType');

      const tagRows = tagIds.length
        ? await tx.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, tagIds))
        : [];
      const stageRows = stageIds.length
        ? await tx
            .select({
              id: stages.id,
              name: stages.name,
              pipelineId: stages.pipelineId,
              pipelineName: pipelines.name,
            })
            .from(stages)
            .leftJoin(pipelines, eq(pipelines.id, stages.pipelineId))
            .where(inArray(stages.id, stageIds))
        : [];
      const pipelineRows = pipelineIds.length
        ? await tx.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(inArray(pipelines.id, pipelineIds))
        : [];
      const agentRows = agentIds.length
        ? await tx.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds))
        : [];
      const channelRows = channelIds.length
        ? await tx
            .select({ id: channels.id, label: channels.name, type: channels.provider })
            .from(channels)
            .where(inArray(channels.id, channelIds))
        : [];
      const memberRows = memberIds.length
        ? await tx.select({ id: members.id, name: members.name, email: members.email }).from(members).where(inArray(members.id, memberIds))
        : [];
      const flowRows = flowIds.length
        ? await tx.select({ id: flows.id, name: flows.name }).from(flows).where(inArray(flows.id, flowIds))
        : [];
      const convRows = convKeys.length
        ? await tx
            .select({ id: conversionTypes.id, key: conversionTypes.key, name: conversionTypes.label })
            .from(conversionTypes)
            .where(inArray(conversionTypes.key, convKeys))
        : [];

      return {
        tags: tagRows,
        stages: stageRows.map((s) => ({
          id: s.id,
          name: s.name,
          pipelineId: s.pipelineId,
          pipelineName: s.pipelineName ?? null,
        })),
        pipelines: pipelineRows,
        agents: agentRows,
        channels: channelRows,
        members: memberRows.map((m) => ({ id: m.id, name: m.name, email: m.email.toLowerCase() })),
        flows: flowRows,
        conversionTypes: convRows,
      };
    },

    async loadTargetLookups(): Promise<TargetLookups> {
      // Workspace-bounded (RLS): carrega o catálogo do destino e indexa por nome/chave/email.
      const [tagRows, stageRows, pipelineRows, agentRows, channelRows, memberRows, flowRows, convRows] =
        await Promise.all([
          tx.select({ id: tags.id, name: tags.name }).from(tags),
          tx
            .select({ id: stages.id, name: stages.name, pipelineName: pipelines.name })
            .from(stages)
            .leftJoin(pipelines, eq(pipelines.id, stages.pipelineId)),
          tx.select({ id: pipelines.id, name: pipelines.name }).from(pipelines),
          tx.select({ id: agents.id, name: agents.name }).from(agents),
          tx.select({ id: channels.id, name: channels.name }).from(channels),
          tx.select({ id: members.id, email: members.email }).from(members),
          tx.select({ id: flows.id, name: flows.name }).from(flows),
          tx.select({ key: conversionTypes.key }).from(conversionTypes),
        ]);

      const tagIdByName = new Map(tagRows.map((t) => [t.name, t.id]));
      const stageIdByPipelineName = new Map<string, string>();
      const stageNameCount = new Map<string, number>();
      const stageIdByName = new Map<string, string>();
      for (const s of stageRows) {
        stageIdByPipelineName.set(stageLookupKey(s.pipelineName ?? null, s.name), s.id);
        stageNameCount.set(s.name, (stageNameCount.get(s.name) ?? 0) + 1);
        stageIdByName.set(s.name, s.id);
      }
      // Remove nomes ambíguos do fallback por-nome (mantém só os únicos).
      for (const [name, count] of stageNameCount) if (count > 1) stageIdByName.delete(name);

      return {
        tagIdByName,
        stageIdByPipelineName,
        stageIdByName,
        pipelineIdByName: new Map(pipelineRows.map((p) => [p.name, p.id])),
        agentIdByName: new Map(agentRows.map((a) => [a.name, a.id])),
        channelIdByName: new Map(channelRows.map((c) => [c.name, c.id])),
        memberIdByEmail: new Map(memberRows.map((m) => [m.email.toLowerCase(), m.id])),
        flowIdByName: new Map(flowRows.map((f) => [f.name, f.id])),
        conversionTypeKeys: new Set(convRows.map((c) => c.key)),
      };
    },

    async existingFlowNames(): Promise<Set<string>> {
      const rows = await tx.select({ name: flows.name }).from(flows);
      return new Set(rows.map((r) => r.name));
    },

    async insertFlows(rows): Promise<void> {
      if (rows.length === 0) return;
      await tx.insert(flows).values(
        rows.map((r: NewFlowRow) => ({
          id: r.id,
          workspaceId: ctx.workspaceId,
          name: r.name,
          description: r.description,
          status: 'draft' as const,
          triggerType: r.triggerType,
          triggerConfig: r.triggerConfig,
          filterStatus: r.filterStatus,
          filterStageIds: r.filterStageIds,
          filterTagIds: r.filterTagIds,
          channelIds: r.channelIds,
          nodes: r.nodes,
          edges: r.edges,
          schemaVersion: r.schemaVersion,
          createdBy: ctx.memberId,
        })),
      );
    },
  };
}
