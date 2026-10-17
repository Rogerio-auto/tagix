/**
 * `list_campaigns` e `get_campaign` · campanhas e seus números (F73-S07).
 *
 * - `list_campaigns` exige `campaign.list`; `get_campaign` exige `campaign.view_metrics` (as
 *   mesmas permissões de `GET /api/campaigns` e `GET /api/campaigns/:id/metrics`).
 * - Números do rollup `campaign_metrics` (o mesmo que a tela de campanha mostra, P5).
 * - Nome da campanha é escrito pela equipe, não por cliente: não contamina o turno.
 * - Custo já usado: só para quem tem `agent.view_costs`. HOJE nenhum custo por campanha é
 *   registrado no banco (o envio da Meta não é precificado e o custo de IA não é ligado à
 *   campanha), então `cost_used` é `null` para todos e quem não pode ver custo não recebe nem
 *   a chave no `model_view`. Quando existir a fonte, ela entra em `loadCampaignCostUsed`, atrás
 *   da MESMA trava.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { can } from '@hm/shared';
import { z } from 'zod';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import { resolveVisible } from '../../../services/copilot/identity/scope';
import { defineCopilotTool } from '../core/registry';
import { clip, loadWorkspaceFormat, notFound } from '../read-crm/common';
import { clampLimit, fitModelView, startRead } from '../read-crm/limits';
import { channelLabel } from './common';

const { campaigns, campaignMetrics, campaignRecipients, channels } = schema;

const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
  'cancelled',
] as const;
const LIST_LIMIT_MAX = 20;
/** Destinatários que ainda vão receber (o "agendadas" da tela). */
const PENDING_RECIPIENT_STATUSES = ['pending', 'sending'] as const;

const n = (v: number | null | undefined): number => (typeof v === 'number' && v > 0 ? v : 0);

/** O membro pode ver custo? (`agent.view_costs`, a régua de custo do produto) */
export function canSeeCosts(principal: Pick<CopilotPrincipal, 'role'>): boolean {
  return can(principal.role, 'agent.view_costs');
}

/**
 * Custo já usado pela campanha, em unidades da moeda do workspace. `null` = sem fonte de custo
 * registrada (estado atual). Só é chamado para quem passou em `canSeeCosts`.
 */
async function loadCampaignCostUsed(_tx: DbTx, _campaignId: string): Promise<number | null> {
  return null;
}

// ─── list_campaigns ─────────────────────────────────────────────────────────────

const ListArgsSchema = z
  .object({
    status: z.enum(CAMPAIGN_STATUSES).optional(),
    limit: z.number().int().min(1).max(LIST_LIMIT_MAX).default(10),
  })
  .strict();

export const listCampaigns = defineCopilotTool({
  key: 'list_campaigns',
  capability: 'query',
  area: 'campaigns',
  description:
    'Lista campanhas (até 20, mais recentes primeiro), opcionalmente por status, com ' +
    'destinatários, enviadas e respostas. Para os números completos de uma use get_campaign.',
  args: ListArgsSchema,
  requires: ['campaign.list'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    const limit = clampLimit(args.limit, 10, LIST_LIMIT_MAX);
    const rows = await tx
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        type: campaigns.type,
        startAt: campaigns.startAt,
        createdAt: campaigns.createdAt,
        provider: channels.provider,
        recipients: campaignMetrics.totalRecipients,
        sent: campaignMetrics.messagesSent,
        replied: campaignMetrics.messagesReplied,
        failed: campaignMetrics.messagesFailed,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(campaigns)
      .innerJoin(channels, eq(channels.id, campaigns.channelId))
      .leftJoin(campaignMetrics, eq(campaignMetrics.campaignId, campaigns.id))
      .where(
        and(
          eq(campaigns.workspaceId, principal.workspaceId),
          ...(args.status ? [eq(campaigns.status, args.status)] : []),
        ),
      )
      .orderBy(desc(campaigns.createdAt), desc(campaigns.id))
      .limit(limit);

    const total = rows[0]?.total ?? 0;
    const truncated = total > rows.length;
    const emitted = ctx.emitResult({
      kind: 'table',
      source: { label: 'Campanhas', as_of: new Date().toISOString(), record_count: total },
      truncated,
      data: {
        currency: null,
        columns: [
          { key: 'campaign_id', label: 'Id', format: 'text' },
          { key: 'name', label: 'Campanha', format: 'text' },
          { key: 'status', label: 'Status', format: 'text' },
          { key: 'channel', label: 'Canal', format: 'text' },
          { key: 'start_at', label: 'Início', format: 'datetime' },
          { key: 'recipients', label: 'Destinatários', format: 'number' },
          { key: 'sent', label: 'Enviadas', format: 'number' },
          { key: 'replied', label: 'Respostas', format: 'number' },
        ],
        rows: rows.map((r) => ({
          campaign_id: r.id,
          name: clip(r.name, 200, 'Campanha'),
          status: r.status,
          channel: channelLabel(r.provider),
          start_at: r.startAt ? r.startAt.toISOString() : null,
          recipients: n(r.recipients),
          sent: n(r.sent),
          replied: n(r.replied),
        })),
      },
    });

    const fitted = fitModelView(rows, (shown, omitted) => ({
      total,
      returned: shown.length,
      truncated: truncated || omitted > 0,
      items: shown.map((r) => ({
        id: r.id,
        name: clip(r.name, 120, 'Campanha'),
        status: r.status,
        type: r.type,
        channel: channelLabel(r.provider),
        start_at: r.startAt ? r.startAt.toISOString() : null,
        recipients: n(r.recipients),
        sent: n(r.sent),
        replied: n(r.replied),
        failed: n(r.failed),
      })),
    }));
    return { ok: true, decision: 'executed', model_view: fitted.view, ...emitted };
  },
});

// ─── get_campaign ───────────────────────────────────────────────────────────────

const GetArgsSchema = z.object({ campaign_id: z.string().uuid() }).strict();

export const getCampaign = defineCopilotTool({
  key: 'get_campaign',
  capability: 'query',
  area: 'campaigns',
  description:
    'Números de UMA campanha pelo id: status, destinatários, enviadas, ainda por enviar, ' +
    'entregues, lidas, respostas e falhas (e o custo, para quem pode ver custos).',
  args: GetArgsSchema,
  requires: ['campaign.view_metrics'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    const visible = await resolveVisible(tx, principal, { type: 'campaign', id: args.campaign_id });
    if (!visible) return notFound('Campanha');

    const [row] = await tx
      .select({
        id: campaigns.id,
        name: campaigns.name,
        status: campaigns.status,
        type: campaigns.type,
        startAt: campaigns.startAt,
        endAt: campaigns.endAt,
        provider: channels.provider,
        recipients: campaignMetrics.totalRecipients,
        sent: campaignMetrics.messagesSent,
        delivered: campaignMetrics.messagesDelivered,
        read: campaignMetrics.messagesRead,
        replied: campaignMetrics.messagesReplied,
        failed: campaignMetrics.messagesFailed,
        blocked: campaignMetrics.messagesBlocked,
        health: campaignMetrics.healthStatus,
        metricsAt: campaignMetrics.updatedAt,
      })
      .from(campaigns)
      .innerJoin(channels, eq(channels.id, campaigns.channelId))
      .leftJoin(campaignMetrics, eq(campaignMetrics.campaignId, campaigns.id))
      .where(and(eq(campaigns.id, visible.id), eq(campaigns.workspaceId, principal.workspaceId)))
      .limit(1);
    if (!row) return notFound('Campanha');

    const [pendingRow] = await tx
      .select({ pending: sql<number>`count(*)`.mapWith(Number) })
      .from(campaignRecipients)
      .where(
        and(
          eq(campaignRecipients.campaignId, row.id),
          eq(campaignRecipients.workspaceId, principal.workspaceId),
          inArray(campaignRecipients.status, [...PENDING_RECIPIENT_STATUSES]),
        ),
      );
    const pending = pendingRow?.pending ?? 0;

    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
    const showCost = canSeeCosts(principal);
    const costUsed = showCost ? await loadCampaignCostUsed(tx, row.id) : null;
    const asOf = (row.metricsAt ?? new Date()).toISOString();

    const numbers = {
      recipients: n(row.recipients),
      sent: n(row.sent),
      delivered: n(row.delivered),
      read: n(row.read),
      replied: n(row.replied),
      failed: n(row.failed),
    };
    const emitted = ctx.emitResult({
      kind: 'campaign_card',
      source: { label: 'Campanhas', as_of: asOf, record_count: 1 },
      truncated: false,
      data: {
        campaign_id: row.id,
        name: clip(row.name, 200, 'Campanha'),
        status: row.status,
        channel: channelLabel(row.provider),
        scheduled_at: row.startAt ? row.startAt.toISOString() : null,
        ...numbers,
        currency: fmt.currency,
        cost_used: costUsed,
      },
    });

    return {
      ok: true,
      decision: 'executed',
      model_view: {
        campaign_id: row.id,
        name: clip(row.name, 120, 'Campanha'),
        status: row.status,
        type: row.type,
        channel: channelLabel(row.provider),
        start_at: row.startAt ? row.startAt.toISOString() : null,
        end_at: row.endAt ? row.endAt.toISOString() : null,
        ...numbers,
        pending,
        blocked: n(row.blocked),
        health: row.health ?? 'healthy',
        metrics_as_of: asOf,
        ...(showCost
          ? {
              currency: fmt.currency,
              cost_used: costUsed,
              ...(costUsed === null
                ? { cost_note: 'Custo por campanha ainda não é registrado.' }
                : {}),
            }
          : {}),
      },
      ...emitted,
    };
  },
});
