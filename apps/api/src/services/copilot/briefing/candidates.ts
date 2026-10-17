/**
 * Coletores de candidatos do briefing (COPILOTO.md §7.1). Um por tipo, todos sob o escopo de
 * quem lê (`services/copilot/identity/scope.ts`: AGENT só vê o que é dele).
 *
 * Regras de leitura (iguais às do S06):
 * - JIT desligado + `statement_timeout` (`startRead`): o predicado do AGENT tem dezenas de
 *   subplanos e o JIT custa 20x a consulta;
 * - "parado" é a régua única `dealIdleDaysSql()` de `@hm/db`, calculada UMA vez por negócio
 *   (`lateral ... offset 0`), igual à lista de negócios do Copiloto;
 * - "leads esperando" é a MESMA consulta do `/api/dashboard/today` (`loadToday`, por import):
 *   mesma fila, mesmas faixas, mesmo recorte por papel. Não há segunda definição;
 * - tudo isto roda dentro da transação RLS do chamador.
 *
 * Cada coletor aceita `only` para a revalidação reconferir UM item (um estágio, uma campanha)
 * pela MESMA consulta que o gerou, em vez de uma segunda lógica que pode divergir.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { calendarRepo, dealIdleDaysSql, schema, type DbTx } from '@hm/db';
import { can } from '@hm/shared';
import { buildDealWhere } from '../../../internal/copilot/read-crm/deal-filters';
import { centsToUnits, round2 } from '../../../internal/copilot/read-crm/common';
import { startRead } from '../../../internal/copilot/read-crm/limits';
import { loadToday } from '../../../routes/dashboard/today';
import { dealScope } from '../identity/scope';
import { acceptProviderCandidate, listBriefingSources } from './sources';
import { textFamily, sourceLabel } from './texts';
import {
  BRIEFING_CAMPAIGN_REACH_RATE,
  BRIEFING_IDLE_DAYS,
  BRIEFING_MAX_GROUPS_PER_KIND,
  BRIEFING_TICKET_WINDOW_DAYS,
  type BriefingCandidate,
  type CandidateContext,
} from './types';

const { deals, stages, events, campaigns, campaignMetrics, copilotSuggestions } = schema;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const REACTIVATION_NAME = /reativ|reactiv|re-?engag|retomad/i;

export interface TicketEstimate {
  readonly value: number;
  readonly basis: 'won_90d' | 'open' | 'none';
}

/**
 * Ticket médio (unidades da moeda) dos ganhos dos últimos 90 dias, no escopo de quem lê.
 * Sem ganhos recentes, cai na média dos negócios em aberto (e diz que caiu, no `why`).
 */
export async function loadTicketEstimate(
  tx: DbTx,
  ctx: CandidateContext,
): Promise<TicketEstimate> {
  const { principal, now } = ctx;
  const scope = dealScope(principal);
  const since = new Date(now.getTime() - BRIEFING_TICKET_WINDOW_DAYS * DAY_MS);
  const base = [eq(deals.workspaceId, principal.workspaceId), sql`${deals.valueCents} > 0`];
  if (scope) base.push(scope);

  const [won] = await tx
    .select({ avg: sql<number | null>`avg(${deals.valueCents})`.mapWith(Number) })
    .from(deals)
    .where(
      and(...base, isNotNull(deals.closedAt), eq(deals.closedWon, true), gte(deals.closedAt, since)),
    );
  if (won && Number.isFinite(won.avg) && won.avg > 0) {
    return { value: round2(centsToUnits(won.avg)), basis: 'won_90d' };
  }
  const [open] = await tx
    .select({ avg: sql<number | null>`avg(${deals.valueCents})`.mapWith(Number) })
    .from(deals)
    .where(and(...base, isNull(deals.closedAt)));
  if (open && Number.isFinite(open.avg) && open.avg > 0) {
    return { value: round2(centsToUnits(open.avg)), basis: 'open' };
  }
  return { value: 0, basis: 'none' };
}

/** Memoiza o ticket: só é lido se algum coletor precisar. */
export type TicketLoader = () => Promise<TicketEstimate>;

export function lazyTicket(tx: DbTx, ctx: CandidateContext): TicketLoader {
  let pending: Promise<TicketEstimate> | null = null;
  return () => (pending ??= loadTicketEstimate(tx, ctx));
}

// ─── deals_idle ──────────────────────────────────────────────────────────────

export async function collectDealsIdle(
  tx: DbTx,
  ctx: CandidateContext,
  only?: { readonly stageId: string },
): Promise<BriefingCandidate[]> {
  const { principal, fmt, now } = ctx;
  if (!can(principal.role, 'pipeline.view')) return [];
  const idleCalc = sql`idle_calc.days`;
  // O relógio do contexto (e não o `now()` do banco) mede o "parado": mesma régua, e
  // reprodutível em teste com relógio fixo. Em produção os dois coincidem.
  const idleNow = sql`${now.toISOString()}::timestamptz`;
  const rows = await tx
    .select({
      stageId: deals.stageId,
      count: sql<number>`count(*)`.mapWith(Number),
      valueCents: sql<number>`coalesce(sum(${deals.valueCents}), 0)`.mapWith(Number),
      maxIdle: sql<number>`max(idle_calc.days)`.mapWith(Number),
      avgIdle: sql<number>`avg(idle_calc.days)`.mapWith(Number),
    })
    .from(deals)
    .innerJoin(
      sql`lateral (select ${dealIdleDaysSql(undefined, idleNow)} as days offset 0) as idle_calc`,
      sql`true`,
    )
    .where(
      buildDealWhere(
        principal,
        {
          idle_days_gte: BRIEFING_IDLE_DAYS,
          ...(only ? { stage_ids: [only.stageId] } : {}),
        },
        { defaultStatus: 'open', timezone: fmt.timezone, idleDays: idleCalc },
      ),
    )
    .groupBy(deals.stageId)
    .orderBy(sql`coalesce(sum(${deals.valueCents}), 0) desc`, deals.stageId)
    .limit(BRIEFING_MAX_GROUPS_PER_KIND);
  if (rows.length === 0) return [];

  // Nomes e estágio de reativação do mesmo funil (poucas linhas, por PK/funil).
  const stageIds = rows.map((r) => r.stageId);
  const groupStages = await tx
    .select({ id: stages.id, name: stages.name, pipelineId: stages.pipelineId })
    .from(stages)
    .where(and(eq(stages.workspaceId, principal.workspaceId), inArray(stages.id, stageIds)));
  const byId = new Map(groupStages.map((s) => [s.id, s]));
  const pipelineIds = [...new Set(groupStages.map((s) => s.pipelineId))];
  const siblings =
    pipelineIds.length === 0
      ? []
      : await tx
          .select({
            id: stages.id,
            name: stages.name,
            pipelineId: stages.pipelineId,
            isWon: stages.isWon,
            isLost: stages.isLost,
          })
          .from(stages)
          .where(
            and(
              eq(stages.workspaceId, principal.workspaceId),
              inArray(stages.pipelineId, pipelineIds),
            ),
          );

  const source = sourceLabel(textFamily(fmt.locale), 'deals_idle');
  return rows.flatMap((r): BriefingCandidate[] => {
    const stage = byId.get(r.stageId);
    if (!stage || r.count <= 0) return [];
    const reactivation = siblings.find(
      (s) =>
        s.pipelineId === stage.pipelineId &&
        s.id !== stage.id &&
        !s.isWon &&
        !s.isLost &&
        REACTIVATION_NAME.test(s.name),
    );
    return [
      {
        kind: 'deals_idle',
        key: `deals_idle:${r.stageId}`,
        valueAtRisk: round2(centsToUnits(r.valueCents)),
        urgency: r.maxIdle,
        oldestAt: new Date(now.getTime() - r.maxIdle * DAY_MS),
        facts: {
          kind: 'deals_idle',
          count: r.count,
          stageId: r.stageId,
          stageName: stage.name,
          idleDaysThreshold: BRIEFING_IDLE_DAYS,
          maxIdleDays: r.maxIdle,
          avgIdleDays: round2(r.avgIdle),
          reactivationStageName: reactivation?.name ?? null,
        },
        refs: { stageId: r.stageId },
        source,
        asOf: now,
      },
    ];
  });
}

// ─── leads_waiting ───────────────────────────────────────────────────────────

export async function collectLeadsWaiting(
  tx: DbTx,
  ctx: CandidateContext,
  ticket: TicketLoader,
): Promise<BriefingCandidate[]> {
  const { principal, fmt, now } = ctx;
  if (!can(principal.role, 'conversation.view')) return [];
  // A mesma fila e as mesmas faixas do `/api/dashboard/today` (F72-S04: recorte por papel).
  const today = await loadToday(tx, {
    workspaceId: principal.workspaceId,
    now,
    viewer: { memberId: principal.memberId, role: principal.role },
  });
  if (today.waitingTotal <= 0) return [];
  const oldest = today.waiting[0];
  const oldestAt = oldest ? new Date(oldest.waitingSince) : now;
  const t = await ticket();
  return [
    {
      kind: 'leads_waiting',
      key: 'leads_waiting',
      valueAtRisk: round2(today.waitingTotal * t.value),
      urgency: oldest?.waitingMinutes ?? 0,
      oldestAt,
      facts: {
        kind: 'leads_waiting',
        count: today.waitingTotal,
        oldestWaitingMinutes: oldest?.waitingMinutes ?? 0,
        ticket: t.value,
        ticketBasis: t.basis,
      },
      refs: {},
      source: sourceLabel(textFamily(fmt.locale), 'leads_waiting'),
      asOf: now,
    },
  ];
}

// ─── events_today ────────────────────────────────────────────────────────────

export async function collectEventsToday(
  tx: DbTx,
  ctx: CandidateContext,
): Promise<BriefingCandidate[]> {
  const { principal, fmt, now, forDate } = ctx;
  if (!can(principal.role, 'calendar.view')) return [];
  const calendarIds = await calendarRepo.accessibleCalendarIds(tx, {
    memberId: principal.memberId,
    role: principal.role,
  });
  if (calendarIds.length === 0) return [];
  // Fim do dia LOCAL do workspace (a data civil do briefing + 1 dia, no fuso dele).
  const endOfDay = sql`((${forDate}::date + 1)::timestamp at time zone ${fmt.timezone})`;
  const rows = await tx
    .select({ id: events.id, startAt: events.startAt, dealId: events.dealId })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, principal.workspaceId),
        // "Sem confirmação": agendado e ainda não confirmado. Cancelado/concluído não conta.
        eq(events.status, 'scheduled'),
        gte(events.startAt, now),
        sql`${events.startAt} < ${endOfDay}`,
        inArray(events.calendarId, [...calendarIds]),
      ),
    )
    .orderBy(events.startAt, events.id)
    .limit(200);
  const first = rows[0];
  if (!first) return [];

  // Valor dos negócios ligados: só os que o membro enxerga (AGENT nunca soma o que não vê).
  const dealIds = [...new Set(rows.flatMap((r) => (r.dealId ? [r.dealId] : [])))];
  let valueCents = 0;
  let dealCount = 0;
  if (dealIds.length > 0 && can(principal.role, 'pipeline.view')) {
    const scope = dealScope(principal);
    const linked = await tx
      .select({ valueCents: deals.valueCents })
      .from(deals)
      .where(
        and(
          eq(deals.workspaceId, principal.workspaceId),
          inArray(deals.id, dealIds),
          isNull(deals.closedAt),
          ...(scope ? [scope] : []),
        ),
      );
    dealCount = linked.length;
    valueCents = linked.reduce((sum, d) => sum + d.valueCents, 0);
  }
  return [
    {
      kind: 'events_today',
      key: 'events_today',
      valueAtRisk: round2(centsToUnits(valueCents)),
      urgency: Math.max(0, (first.startAt.getTime() - now.getTime()) / HOUR_MS),
      oldestAt: first.startAt,
      facts: {
        kind: 'events_today',
        count: rows.length,
        dealCount,
        hoursUntilFirst: Math.max(0, (first.startAt.getTime() - now.getTime()) / HOUR_MS),
      },
      refs: {},
      source: sourceLabel(textFamily(fmt.locale), 'events_today'),
      asOf: now,
    },
  ];
}

// ─── autopilot_pending ───────────────────────────────────────────────────────

/**
 * Sugestões do piloto pendentes em estágios com `daily_approval`. Vazio enquanto o gerador
 * (F73-S13) não gravar nada: a consulta é a definitiva, só não encontra linhas ainda.
 */
export async function collectAutopilotPending(
  tx: DbTx,
  ctx: CandidateContext,
): Promise<BriefingCandidate[]> {
  const { principal, fmt, now } = ctx;
  if (!can(principal.role, 'pipeline.view')) return [];
  const scope = dealScope(principal);
  const s = copilotSuggestions;
  const [row] = await tx
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      valueCents: sql<number>`coalesce(sum(${deals.valueCents}), 0)`.mapWith(Number),
      oldest: sql<Date | null>`min(${s.createdAt})`.mapWith((v) =>
        v === null || v === undefined ? null : new Date(v as string | Date),
      ),
    })
    .from(s)
    .innerJoin(deals, eq(deals.id, s.dealId))
    .where(
      and(
        eq(s.workspaceId, principal.workspaceId),
        eq(s.status, 'pending'),
        isNull(deals.closedAt),
        sql`exists (
          select 1 from copilot_autopilot_rules r
           where r.workspace_id = ${s.workspaceId}
             and r.stage_id = ${s.fromStageId}
             and r.mode = 'daily_approval'
        )`,
        ...(scope ? [scope] : []),
      ),
    );
  if (!row || row.count <= 0) return [];
  return [
    {
      kind: 'autopilot_pending',
      key: 'autopilot_pending',
      valueAtRisk: round2(centsToUnits(row.valueCents)),
      urgency: 0,
      oldestAt: row.oldest ?? now,
      facts: { kind: 'autopilot_pending', count: row.count },
      refs: {},
      source: sourceLabel(textFamily(fmt.locale), 'autopilot_pending'),
      asOf: now,
    },
  ];
}

// ─── campaign_issue ──────────────────────────────────────────────────────────

const CAMPAIGN_ISSUE_LIMIT = 5;

/**
 * Campanha rodando ou pausada com saúde em alerta/crítica e falhas de envio. Não existe custo
 * de campanha no código (COPILOTO.md §11): o valor é o alcance pendente × ticket médio × uma
 * taxa conservadora (`BRIEFING_CAMPAIGN_REACH_RATE`), e o `why` mostra a conta.
 */
export async function collectCampaignIssues(
  tx: DbTx,
  ctx: CandidateContext,
  ticket: TicketLoader,
  only?: { readonly campaignId: string },
): Promise<BriefingCandidate[]> {
  const { principal, fmt } = ctx;
  if (!can(principal.role, 'campaign.list') || !can(principal.role, 'campaign.view_metrics')) {
    return [];
  }
  const m = campaignMetrics;
  const rows = await tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      health: m.healthStatus,
      total: m.totalRecipients,
      sent: m.messagesSent,
      failed: m.messagesFailed,
      blocked: m.messagesBlocked,
      updatedAt: m.updatedAt,
    })
    .from(campaigns)
    .innerJoin(m, eq(m.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.workspaceId, principal.workspaceId),
        inArray(campaigns.status, ['running', 'paused']),
        inArray(m.healthStatus, ['warning', 'critical']),
        sql`${m.messagesFailed} > 0`,
        ...(only ? [eq(campaigns.id, only.campaignId)] : []),
      ),
    )
    .orderBy(sql`(${m.healthStatus} = 'critical') desc`, desc(m.messagesFailed), campaigns.id)
    .limit(CAMPAIGN_ISSUE_LIMIT);
  if (rows.length === 0) return [];
  const t = await ticket();
  const source = sourceLabel(textFamily(fmt.locale), 'campaign_issue');
  return rows.map((r): BriefingCandidate => {
    const pending = Math.max(0, r.total - r.sent - r.failed - r.blocked);
    const health = r.health === 'critical' ? 'critical' : 'warning';
    return {
      kind: 'campaign_issue',
      key: `campaign_issue:${r.id}`,
      valueAtRisk: round2(pending * t.value * BRIEFING_CAMPAIGN_REACH_RATE),
      urgency: health === 'critical' ? 1 : 0,
      oldestAt: r.updatedAt,
      facts: {
        kind: 'campaign_issue',
        campaignId: r.id,
        campaignName: r.name,
        health,
        sent: r.sent,
        total: r.total,
        failed: r.failed,
        pending,
        ticket: t.value,
      },
      refs: { campaignId: r.id },
      source,
      asOf: ctx.now,
    };
  });
}

// ─── integration_alert (seam da F75) ─────────────────────────────────────────

export async function collectProviderAlerts(ctx: CandidateContext): Promise<BriefingCandidate[]> {
  const out: BriefingCandidate[] = [];
  for (const provider of listBriefingSources()) {
    try {
      for (const candidate of await provider.collect(ctx)) {
        const accepted = acceptProviderCandidate(provider, candidate, ctx.now);
        if (accepted) out.push(accepted);
      }
    } catch {
      // Um provedor quebrado não derruba o briefing dos demais tipos.
    }
  }
  return out;
}

// ─── Tudo ────────────────────────────────────────────────────────────────────

/** Todos os candidatos do membro, sem ordem definida (quem ordena é o `compose`). */
export async function collectCandidates(
  tx: DbTx,
  ctx: CandidateContext,
): Promise<BriefingCandidate[]> {
  await startRead(tx);
  const ticket = lazyTicket(tx, ctx);
  const groups = [
    await collectDealsIdle(tx, ctx),
    await collectLeadsWaiting(tx, ctx, ticket),
    await collectEventsToday(tx, ctx),
    await collectAutopilotPending(tx, ctx),
    await collectCampaignIssues(tx, ctx, ticket),
    await collectProviderAlerts(ctx),
  ];
  return groups.flat();
}
