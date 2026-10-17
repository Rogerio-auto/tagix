/**
 * `get_deal` · um negócio em detalhe (F73-S06): valor, estágio, tempo no estágio, dias
 * parado, histórico resumido (5 últimos eventos de `deal_history`) e itens/produtos.
 *
 * Visibilidade: `resolveVisible` (o mesmo predicado das telas). Inexistente, de outro
 * workspace e fora do escopo do membro são a mesma resposta: `not_found`.
 *
 * Parcelas: o modelo de dados ainda não tem parcelamento de negócio; `installments` sai
 * sempre `null` (o contrato aceita `null`). Notas e campos personalizados do negócio NÃO
 * entram: podem carregar texto de terceiros.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { dealIdleDaysSql, schema, type DbTx } from '@hm/db';
import { z } from 'zod';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import { resolveVisible } from '../../../services/copilot/identity/scope';
import { defineCopilotTool } from '../core/registry';
import {
  centsToUnits,
  clip,
  clipOrNull,
  guardPhoneLike,
  loadWorkspaceFormat,
  notFound,
} from './common';
import { startRead } from './limits';

const { deals, stages, pipelines, contacts, members, dealItems, dealHistory } = schema;

const ArgsSchema = z.object({ deal_id: z.string().uuid() }).strict();

const HISTORY_LIMIT = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HistoryRow {
  readonly eventType: string;
  readonly fromValue: Record<string, unknown> | null;
  readonly toValue: Record<string, unknown> | null;
  readonly createdAt: Date;
}

function stageIdOf(value: Record<string, unknown> | null): string | null {
  const id = value?.['stageId'];
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

/** Evento do histórico em linguagem de negócio. Nunca o texto de uma nota ou de um campo. */
export function describeHistoryEvent(
  row: HistoryRow,
  stageNames: ReadonlyMap<string, string>,
): string {
  switch (row.eventType) {
    case 'created':
      return 'Negócio criado';
    case 'stage_changed': {
      const from = stageNames.get(stageIdOf(row.fromValue) ?? '');
      const to = stageNames.get(stageIdOf(row.toValue) ?? '');
      if (from && to) return `Movido de ${from} para ${to}`;
      return to ? `Movido para ${to}` : 'Movido de estágio';
    }
    case 'owner_changed':
      return 'Responsável alterado';
    case 'field_updated':
      return 'Dados do negócio atualizados';
    case 'closed':
      return row.toValue?.['closedWon'] === true ? 'Fechado como ganho' : 'Fechado como perdido';
    case 'reopened':
      return 'Negócio reaberto';
    case 'note_added':
      return 'Nota adicionada';
    case 'attachment_added':
      return 'Anexo adicionado';
    default:
      return 'Atualização do negócio';
  }
}

async function loadHistory(tx: DbTx, dealId: string): Promise<{ at: string; label: string }[]> {
  const rows = await tx
    .select({
      eventType: dealHistory.eventType,
      fromValue: dealHistory.fromValue,
      toValue: dealHistory.toValue,
      createdAt: dealHistory.createdAt,
    })
    .from(dealHistory)
    .where(eq(dealHistory.dealId, dealId))
    .orderBy(desc(dealHistory.createdAt), desc(dealHistory.id))
    .limit(HISTORY_LIMIT);
  const stageIds = new Set<string>();
  for (const r of rows) {
    for (const v of [r.fromValue, r.toValue]) {
      const id = stageIdOf(v);
      if (id) stageIds.add(id);
    }
  }
  const names = new Map<string, string>();
  if (stageIds.size > 0) {
    const found = await tx
      .select({ id: stages.id, name: stages.name })
      .from(stages)
      .where(inArray(stages.id, [...stageIds]));
    for (const s of found) names.set(s.id, clip(s.name, 60, 'Estágio'));
  }
  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    label: clip(describeHistoryEvent(r, names), 200, 'Atualização do negócio'),
  }));
}

/** Dias no estágio atual: desde o último `stage_changed` (ou a criação, se nunca foi movido). */
const daysInStageSql = sql<number>`greatest(0, floor(extract(epoch from (now() - coalesce(
  (select max(dh.created_at) from deal_history dh
    where dh.deal_id = "deals"."id" and dh.event_type = 'stage_changed'),
  "deals"."created_at"
))) / 86400))::int`.mapWith(Number);

export const getDeal = defineCopilotTool({
  key: 'get_deal',
  capability: 'query',
  area: 'pipeline',
  description:
    'Detalhes de UM negócio pelo id: valor, estágio, tempo no estágio, dias parado, responsável, ' +
    'últimos 5 eventos do histórico e itens/produtos. Use depois de list_deals quando precisar ' +
    'aprofundar um negócio.',
  args: ArgsSchema,
  requires: ['pipeline.view'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    const visible = await resolveVisible(tx, principal, { type: 'deal', id: args.deal_id });
    if (!visible) return notFound('Negócio');
    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
    const loaded = await loadDeal(tx, principal, args.deal_id);
    if (!loaded) return notFound('Negócio');
    const { row, items } = loaded;
    const history = await loadHistory(tx, args.deal_id);

    const status = row.closedAt === null ? 'open' : row.closedWon === true ? 'won' : 'lost';
    const idleDays = row.closedAt === null ? row.idleDays : null;
    const value = centsToUnits(row.valueCents);
    const products = items.map((i) => ({
      name: clip(i.name, 200, 'Item'),
      quantity: i.qty,
      value: centsToUnits(i.qty * i.unitPriceCents),
    }));

    const emitted = ctx.emitResult({
      kind: 'deal_card',
      source: {
        label: 'Negócio do pipeline',
        as_of: new Date().toISOString(),
        record_count: 1,
      },
      truncated: false,
      data: {
        deal_id: row.id,
        title: clip(row.title, 200, 'Negócio'),
        contact: row.contactId
          ? {
              contact_id: row.contactId,
              name: clip(row.contactName ?? row.contactProfile, 200, 'Contato sem nome'),
            }
          : null,
        currency: fmt.currency,
        value,
        installments: null,
        pipeline_name: clip(row.pipelineName, 120, 'Funil'),
        stage: { stage_id: row.stageId, name: clip(row.stageName, 120, 'Estágio') },
        days_in_stage: row.daysInStage,
        idle_days: idleDays,
        owner_name: clipOrNull(row.ownerName, 120),
        history,
        products: products.slice(0, 20),
      },
    });

    return {
      ok: true,
      decision: 'executed',
      model_view: {
        id: row.id,
        title: guardPhoneLike(clip(row.title, 80, 'Negócio')),
        status,
        value,
        currency: fmt.currency,
        pipeline: clip(row.pipelineName, 60, 'Funil'),
        stage: { id: row.stageId, name: clip(row.stageName, 60, 'Estágio') },
        days_in_stage: row.daysInStage,
        idle_days: idleDays,
        owner: row.ownerId ? { id: row.ownerId, name: clipOrNull(row.ownerName, 60) } : null,
        contact_id: row.contactId,
        history: history.map((h) => `${h.at.slice(0, 10)} ${h.label}`),
        items: products.slice(0, 20).map((p) => ({
          name: clip(p.name, 60, 'Item'),
          quantity: p.quantity,
          value: p.value,
        })),
      },
      ...emitted,
    };
  },
});

async function loadDeal(tx: DbTx, principal: CopilotPrincipal, dealId: string) {
  const [row] = await tx
    .select({
      id: deals.id,
      title: deals.title,
      valueCents: deals.valueCents,
      closedAt: deals.closedAt,
      closedWon: deals.closedWon,
      stageId: deals.stageId,
      stageName: stages.name,
      pipelineName: pipelines.name,
      ownerId: deals.ownerId,
      ownerName: members.name,
      contactId: contacts.id,
      contactName: contacts.displayName,
      contactProfile: contacts.profileName,
      idleDays: dealIdleDaysSql(),
      daysInStage: daysInStageSql,
    })
    .from(deals)
    .innerJoin(stages, eq(stages.id, deals.stageId))
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(members, eq(members.id, deals.ownerId))
    .where(and(eq(deals.id, dealId), eq(deals.workspaceId, principal.workspaceId)))
    .limit(1);
  if (!row) return null;
  const items = await tx
    .select({
      name: dealItems.nameSnapshot,
      qty: dealItems.qty,
      unitPriceCents: dealItems.unitPriceCents,
    })
    .from(dealItems)
    .where(eq(dealItems.dealId, dealId))
    .orderBy(dealItems.position)
    .limit(20);
  return { row, items };
}
