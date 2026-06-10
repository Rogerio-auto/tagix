/**
 * Impl real do FlowsQueryPort (Drizzle sob RLS) + factory das deps de trigger dispatch.
 * Wireia a engine real de @hm/flow-engine. O index do worker compoe isto.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import { triggerFlow, resumeFlowWithResponse } from '@hm/flow-engine';
import type { Logger } from '@hm/logger';
import type { ActiveFlow, FlowEnginePort, FlowsQueryPort } from './types';
import type { TriggerDispatchDeps } from './dispatcher';

const { flows } = schema;

export const flowsQueryPort: FlowsQueryPort = {
  async findActiveByTriggerTypes(workspaceId, triggerTypes) {
    return withWorkspace(workspaceId, async (tx) => {
      const rows = await tx
        .select({
          id: flows.id,
          workspaceId: flows.workspaceId,
          triggerType: flows.triggerType,
          triggerConfig: flows.triggerConfig,
          channelIds: flows.channelIds,
        })
        .from(flows)
        .where(and(eq(flows.status, 'active'), inArray(flows.triggerType, [...triggerTypes])));
      return rows.map(
        (r): ActiveFlow => ({
          id: r.id,
          workspaceId: r.workspaceId,
          triggerType: r.triggerType,
          triggerConfig: (r.triggerConfig ?? {}) as Record<string, unknown>,
          channelIds: r.channelIds ?? null,
        }),
      );
    });
  },
};

/** Engine port real (API publica de @hm/flow-engine com ports default). */
export const flowEnginePort: FlowEnginePort = {
  triggerFlow,
  resumeFlowWithResponse,
};

/** Monta as deps do trigger dispatcher (DB real + engine real). */
export function createTriggerDispatchDeps(logger: Logger): TriggerDispatchDeps {
  return { flowsQuery: flowsQueryPort, engine: flowEnginePort, logger };
}
