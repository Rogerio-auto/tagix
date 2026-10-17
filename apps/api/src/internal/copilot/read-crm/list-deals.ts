/**
 * `list_deals` · lista negócios sob o escopo do membro (F73-S06).
 *
 * Padrão: negócios EM ABERTO. Ordenação: `value_desc` (padrão), `idle_desc` (mais parados
 * primeiro) ou `created_desc`. "Dias parado" é a régua única de `@hm/db` (`dealIdleDaysSql`).
 *
 * O cartão (`deal_list`) leva o que a tela mostra, incluindo o nome do contato. O `model_view`
 * leva ids, números e nomes curtos: nada de nome de contato, telefone, notas ou campos
 * personalizados (essas informações só saem em `get_contact`/`search_contacts`, que marcam o
 * turno como contaminado).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { dealIdleDaysSql, schema, type DbTx } from '@hm/db';
import { z } from 'zod';
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
import { buildDealWhere, dealFilterShape } from './deal-filters';
import { clampLimit, fitModelView, READ_MAX_ROWS, startRead } from './limits';

const { deals, stages, contacts, members } = schema;

const SORTS = ['value_desc', 'idle_desc', 'created_desc'] as const;

const ArgsSchema = z
  .object({
    ...dealFilterShape,
    sort: z
      .enum(SORTS)
      .default('value_desc')
      .describe(
        'value_desc = maiores valores; idle_desc = mais parados; created_desc = mais novos.',
      ),
    limit: z.number().int().min(1).max(READ_MAX_ROWS).default(25),
  })
  .strict();

interface NameLookups {
  readonly stages: Map<string, string>;
  readonly owners: Map<string, string>;
  readonly contacts: Map<string, string>;
}

/** Nomes por PK das linhas já limitadas (no máximo 50 de cada). */
async function loadNames(
  tx: DbTx,
  workspaceId: string,
  rows: readonly { stageId: string; ownerId: string | null; contactId: string }[],
): Promise<NameLookups> {
  const stageIds = [...new Set(rows.map((r) => r.stageId))];
  const ownerIds = [...new Set(rows.flatMap((r) => (r.ownerId ? [r.ownerId] : [])))];
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const out: NameLookups = { stages: new Map(), owners: new Map(), contacts: new Map() };
  if (rows.length === 0) return out;
  const [stageRows, ownerRows, contactRows] = await Promise.all([
    tx
      .select({ id: stages.id, name: stages.name })
      .from(stages)
      .where(and(eq(stages.workspaceId, workspaceId), inArray(stages.id, stageIds))),
    ownerIds.length === 0
      ? Promise.resolve([] as { id: string; name: string | null }[])
      : tx
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(and(eq(members.workspaceId, workspaceId), inArray(members.id, ownerIds))),
    tx
      .select({ id: contacts.id, name: contacts.displayName, profile: contacts.profileName })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, contactIds))),
  ]);
  for (const r of stageRows) out.stages.set(r.id, r.name);
  for (const r of ownerRows) if (r.name) out.owners.set(r.id, r.name);
  for (const r of contactRows) {
    const name = r.name ?? r.profile;
    if (name) out.contacts.set(r.id, name);
  }
  return out;
}

export const listDeals = defineCopilotTool({
  key: 'list_deals',
  capability: 'query',
  area: 'pipeline',
  description:
    'Lista negócios do pipeline que a pessoa pode ver, com filtros (funil, estágios, responsável, ' +
    'status, parados há N dias, faixa de valor, datas de criação). Padrão: negócios em aberto. ' +
    'Devolve até 50 linhas e o total que casou com o filtro. Use para "quais negócios…", ' +
    '"quem está parado", "os maiores negócios". Para somas e médias use aggregate_deals.',
  args: ArgsSchema,
  requires: ['pipeline.view'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
    if (
      args.pipeline_id &&
      !(await resolveVisible(tx, principal, { type: 'pipeline', id: args.pipeline_id }))
    ) {
      return notFound('Funil');
    }

    // Filtrar ou ordenar por "parado" avalia a régua para TODO negócio do recorte. Nesse caso
    // ela é calculada uma vez por linha (`lateral ... offset 0` impede o Postgres de inliná-la
    // e repeti-la no filtro, na ordenação e na lista). Sem isso, a régua só roda nas linhas
    // que sobram depois do LIMIT.
    const idleOnce = args.idle_days_gte !== undefined || args.sort === 'idle_desc';
    const idleCalc = sql`idle_calc.days`;
    const idle = (idleOnce ? sql<number>`${idleCalc}`.mapWith(Number) : dealIdleDaysSql()).as(
      'idle_days',
    );
    const order =
      args.sort === 'idle_desc'
        ? [desc(idle), desc(deals.valueCents), deals.id]
        : args.sort === 'created_desc'
          ? [desc(deals.createdAt), deals.id]
          : [desc(deals.valueCents), deals.id];

    // Só `deals` na consulta principal: com JOINs o planejador pode repetir o recorte por
    // estágio (medido: a régua de "parado" rodava 6x por negócio). Os nomes vêm depois, por
    // PK, só para as linhas que sobraram do LIMIT.
    const limit = clampLimit(args.limit, 25);
    const base = tx
      .select({
        id: deals.id,
        title: deals.title,
        valueCents: deals.valueCents,
        closedAt: deals.closedAt,
        closedWon: deals.closedWon,
        stageId: deals.stageId,
        ownerId: deals.ownerId,
        contactId: deals.contactId,
        idleDays: idle,
        total: sql<number>`count(*) over ()`.mapWith(Number).as('total'),
      })
      .from(deals)
      .$dynamic();
    const joined = idleOnce
      ? base.innerJoin(
          sql`lateral (select ${dealIdleDaysSql()} as days offset 0) as idle_calc`,
          sql`true`,
        )
      : base;
    const found = await joined
      .where(
        buildDealWhere(principal, args, {
          defaultStatus: 'open',
          timezone: fmt.timezone,
          ...(idleOnce ? { idleDays: idleCalc } : {}),
        }),
      )
      .orderBy(...order)
      .limit(limit);

    const names = await loadNames(tx, principal.workspaceId, found);
    const rows = found.map((r) => ({
      ...r,
      stageName: names.stages.get(r.stageId) ?? 'Estágio',
      ownerName: r.ownerId ? (names.owners.get(r.ownerId) ?? null) : null,
      contactName: names.contacts.get(r.contactId) ?? null,
    }));

    const total = rows[0]?.total ?? 0;
    const statusOf = (r: (typeof rows)[number]): 'open' | 'won' | 'lost' =>
      r.closedAt === null ? 'open' : r.closedWon === true ? 'won' : 'lost';
    const idleOf = (r: (typeof rows)[number]): number | null =>
      r.closedAt === null ? r.idleDays : null;

    const truncated = total > rows.length;
    const emitted = ctx.emitResult({
      kind: 'deal_list',
      source: {
        label: 'Negócios do pipeline',
        as_of: new Date().toISOString(),
        record_count: total,
      },
      truncated,
      data: {
        currency: fmt.currency,
        total,
        items: rows.map((r) => ({
          deal_id: r.id,
          title: clip(r.title, 200, 'Negócio'),
          contact_name: clipOrNull(r.contactName, 200),
          value: centsToUnits(r.valueCents),
          stage: { stage_id: r.stageId, name: clip(r.stageName, 120, 'Estágio') },
          owner_name: clipOrNull(r.ownerName, 120),
          idle_days: idleOf(r),
        })),
      },
    });

    const fitted = fitModelView(rows, (shown, omitted) => ({
      total,
      returned: shown.length,
      truncated: truncated || omitted > 0,
      ...(omitted > 0 ? { omitted_for_size: omitted } : {}),
      currency: fmt.currency,
      sort: args.sort,
      items: shown.map((r) => ({
        id: r.id,
        title: guardPhoneLike(clip(r.title, 80, 'Negócio')),
        value: centsToUnits(r.valueCents),
        stage: clip(r.stageName, 60, 'Estágio'),
        owner: clipOrNull(r.ownerName, 60),
        idle_days: idleOf(r),
        status: statusOf(r),
      })),
    }));

    return { ok: true, decision: 'executed', model_view: fitted.view, ...emitted };
  },
});
