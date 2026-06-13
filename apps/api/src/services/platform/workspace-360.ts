/**
 * Agregacoes do Workspace 360 (F26-S02, PLATFORM_TENANT_MANAGEMENT secao 4).
 * Cross-workspace como owner via getDb (sem RLS de tenant; guard e a fronteira).
 * INVARIANTE: nenhum secret/token de canal cruza a fronteira -- so metadados.
 */
import { and, count, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';

const {
  workspaces,
  members,
  plans,
  channels,
  agents,
  workspaceAgentPolicies,
  llmUsageLogs,
  auditLogs,
  outboundWebhookDeliveries,
  conversations,
  deals,
} = schema;

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  planKey: string | null;
  planName: string | null;
  memberCount: number;
  monthCostUsd: number;
  createdAt: string;
}

export interface TenantListParams {
  search?: string;
  status?: string;
  planKey?: string;
  limit: number;
  offset: number;
}

export async function listTenants(
  params: TenantListParams,
): Promise<{ items: TenantListItem[]; total: number }> {
  const db = getDb();

  const conds = [];
  if (params.search) {
    const term = `%${params.search}%`;
    conds.push(or(ilike(workspaces.name, term), ilike(workspaces.slug, term)));
  }
  if (params.status) conds.push(eq(workspaces.subscriptionStatus, params.status));
  if (params.planKey) conds.push(eq(plans.key, params.planKey));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const spend = db
    .select({
      workspaceId: llmUsageLogs.workspaceId,
      monthCost: sql<number>`coalesce(sum(${llmUsageLogs.costUsd}), 0)::float8`.as('month_cost'),
    })
    .from(llmUsageLogs)
    .where(and(gte(llmUsageLogs.createdAt, monthStart()), eq(llmUsageLogs.isTest, false)))
    .groupBy(llmUsageLogs.workspaceId)
    .as('spend');

  const memberAgg = db
    .select({
      workspaceId: members.workspaceId,
      memberCount: sql<number>`count(*)::int`.as('member_count'),
    })
    .from(members)
    .groupBy(members.workspaceId)
    .as('member_agg');

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      subscriptionStatus: workspaces.subscriptionStatus,
      trialEndsAt: workspaces.trialEndsAt,
      createdAt: workspaces.createdAt,
      planKey: plans.key,
      planName: plans.name,
      memberCount: sql<number>`coalesce(${memberAgg.memberCount}, 0)::int`,
      monthCostUsd: sql<number>`coalesce(${spend.monthCost}, 0)::float8`,
    })
    .from(workspaces)
    .leftJoin(plans, eq(plans.id, workspaces.planId))
    .leftJoin(spend, eq(spend.workspaceId, workspaces.id))
    .leftJoin(memberAgg, eq(memberAgg.workspaceId, workspaces.id))
    .where(where)
    .orderBy(desc(workspaces.createdAt))
    .limit(params.limit)
    .offset(params.offset);

  const [totalRow] = await db
    .select({ total: count() })
    .from(workspaces)
    .leftJoin(plans, eq(plans.id, workspaces.planId))
    .where(where);

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      subscriptionStatus: r.subscriptionStatus,
      trialEndsAt: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
      planKey: r.planKey,
      planName: r.planName,
      memberCount: r.memberCount,
      monthCostUsd: r.monthCostUsd,
      createdAt: r.createdAt.toISOString(),
    })),
    total: totalRow?.total ?? 0,
  };
}

export interface Workspace360 {
  summary: {
    id: string;
    name: string;
    slug: string;
    industry: string | null;
    subscriptionStatus: string;
    trialEndsAt: string | null;
    createdAt: string;
    planKey: string | null;
    planName: string | null;
    owner: { id: string; name: string | null; email: string } | null;
  };
  usage: {
    monthCostUsd: number;
    monthTokens: number;
    capUsd: number | null;
    pctOfCap: number | null;
  };
  members: {
    id: string;
    name: string | null;
    email: string;
    role: string;
    lastSeenAt: string | null;
  }[];
  channels: { id: string; provider: string; name: string; isActive: boolean }[];
  agents: { id: string; name: string; model: string; status: string }[];
  health: {
    failedWebhookDeliveries: number;
    openConversations: number;
    openDeals: number;
    capExceeded: boolean;
    trialExpired: boolean;
  };
  recentAudit: {
    id: string;
    action: string;
    resourceType: string;
    actorType: string;
    createdAt: string;
  }[];
}

export async function getWorkspace360(workspaceId: string): Promise<Workspace360 | null> {
  const db = getDb();

  const [ws] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      industry: workspaces.industry,
      subscriptionStatus: workspaces.subscriptionStatus,
      trialEndsAt: workspaces.trialEndsAt,
      createdAt: workspaces.createdAt,
      planKey: plans.key,
      planName: plans.name,
    })
    .from(workspaces)
    .leftJoin(plans, eq(plans.id, workspaces.planId))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return null;

  const monthFrom = monthStart();

  const [usageRow] = await db
    .select({
      cost: sql<number>`coalesce(sum(${llmUsageLogs.costUsd}), 0)::float8`,
      tokens: sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}), 0)::int`,
    })
    .from(llmUsageLogs)
    .where(
      and(
        eq(llmUsageLogs.workspaceId, workspaceId),
        gte(llmUsageLogs.createdAt, monthFrom),
        eq(llmUsageLogs.isTest, false),
      ),
    );

  const [policyRow] = await db
    .select({ cap: workspaceAgentPolicies.maxMonthlyCostUsd })
    .from(workspaceAgentPolicies)
    .where(eq(workspaceAgentPolicies.workspaceId, workspaceId))
    .limit(1);

  const memberRows = await db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      role: members.role,
      lastSeenAt: members.lastSeenAt,
    })
    .from(members)
    .where(eq(members.workspaceId, workspaceId))
    .orderBy(desc(members.lastSeenAt));

  const ownerRow = memberRows.find((m) => m.role === 'OWNER') ?? null;

  const channelRows = await db
    .select({
      id: channels.id,
      provider: channels.provider,
      name: channels.name,
      isActive: channels.isActive,
    })
    .from(channels)
    .where(eq(channels.workspaceId, workspaceId));

  const agentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      model: agents.model,
      status: agents.status,
    })
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId));

  const [failedWebhooks] = await db
    .select({ n: count() })
    .from(outboundWebhookDeliveries)
    .where(
      and(
        eq(outboundWebhookDeliveries.workspaceId, workspaceId),
        eq(outboundWebhookDeliveries.status, 'failed'),
      ),
    );

  const [openConvs] = await db
    .select({ n: count() })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.status, 'open')));

  const [openDeals] = await db
    .select({ n: count() })
    .from(deals)
    .where(and(eq(deals.workspaceId, workspaceId), isNull(deals.closedAt)));

  const auditRows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      actorType: auditLogs.actorType,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.workspaceId, workspaceId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(20);

  const monthCost = usageRow?.cost ?? 0;
  const capUsd = policyRow?.cap != null ? Number(policyRow.cap) : null;
  const pctOfCap = capUsd && capUsd > 0 ? monthCost / capUsd : null;
  const trialExpired =
    ws.subscriptionStatus === 'trial' && ws.trialEndsAt != null && ws.trialEndsAt < new Date();

  return {
    summary: {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      industry: ws.industry,
      subscriptionStatus: ws.subscriptionStatus,
      trialEndsAt: ws.trialEndsAt ? ws.trialEndsAt.toISOString() : null,
      createdAt: ws.createdAt.toISOString(),
      planKey: ws.planKey,
      planName: ws.planName,
      owner: ownerRow ? { id: ownerRow.id, name: ownerRow.name, email: ownerRow.email } : null,
    },
    usage: { monthCostUsd: monthCost, monthTokens: usageRow?.tokens ?? 0, capUsd, pctOfCap },
    members: memberRows.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null,
    })),
    channels: channelRows,
    agents: agentRows,
    health: {
      failedWebhookDeliveries: failedWebhooks?.n ?? 0,
      openConversations: openConvs?.n ?? 0,
      openDeals: openDeals?.n ?? 0,
      capExceeded: pctOfCap != null && pctOfCap >= 1,
      trialExpired,
    },
    recentAudit: auditRows.map((a) => ({
      id: a.id,
      action: a.action,
      resourceType: a.resourceType,
      actorType: a.actorType,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
