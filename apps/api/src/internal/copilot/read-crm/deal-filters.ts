/**
 * Filtros de negócios compartilhados por `list_deals` e `aggregate_deals` (F73-S06).
 *
 * O Zod aqui é a ÚNICA definição dos filtros; o JSON Schema que o modelo vê sai dele. O SQL
 * sai de `buildDealWhere`, que sempre começa por workspace + `dealScope(principal)` (o escopo
 * do Copiloto vive num só lugar: `services/copilot/identity/scope.ts`).
 *
 * Régua de "parado": `dealIdleDaysSql()` de `@hm/db` (F73-S01), por import. Quando há conversa
 * vinculada, dias desde a última mensagem DO CONTATO; sem conversa, desde `deals.updated_at`.
 * As tabelas entram no FROM sem alias (exigência de `dealScope` e de `dealIdleDaysSql`).
 */
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { dealIdleDaysSql, schema } from '@hm/db';
import { z } from 'zod';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import { dealScope } from '../../../services/copilot/identity/scope';

const { deals } = schema;

/** Data civil (`2026-10-01`) ou instante ISO com fuso. */
const DateOrInstant = z.union([z.string().date(), z.string().datetime({ offset: true })]);

export const DEAL_STATUSES = ['open', 'won', 'lost'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Campos de filtro (espalhe em `z.object({...}).strict()`). */
export const dealFilterShape = {
  pipeline_id: z.string().uuid().optional().describe('Restringe a um funil (pipeline).'),
  stage_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(20)
    .optional()
    .describe('Restringe a estes estágios.'),
  owner_id: z
    .union([z.literal('me'), z.string().uuid()])
    .optional()
    .describe('Responsável. Use "me" para os negócios da própria pessoa que pergunta.'),
  status: z
    .enum(DEAL_STATUSES)
    .optional()
    .describe('open = em aberto, won = ganho, lost = perdido.'),
  idle_days_gte: z
    .number()
    .int()
    .min(0)
    .max(3650)
    .optional()
    .describe('Parados há pelo menos N dias (dias sem mensagem do contato).'),
  value_gte: z.number().min(0).max(1e12).optional().describe('Valor mínimo, na moeda da empresa.'),
  value_lte: z.number().min(0).max(1e12).optional().describe('Valor máximo, na moeda da empresa.'),
  created_from: DateOrInstant.optional().describe(
    'Criados a partir de (data AAAA-MM-DD ou instante ISO).',
  ),
  created_to: DateOrInstant.optional().describe(
    'Criados até (data AAAA-MM-DD, inclusive, ou instante ISO).',
  ),
} as const;

export interface DealFilterArgs {
  readonly pipeline_id?: string | undefined;
  readonly stage_ids?: readonly string[] | undefined;
  readonly owner_id?: string | undefined;
  readonly status?: DealStatus | undefined;
  readonly idle_days_gte?: number | undefined;
  readonly value_gte?: number | undefined;
  readonly value_lte?: number | undefined;
  readonly created_from?: string | undefined;
  readonly created_to?: string | undefined;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Início do instante pedido: data civil no fuso do workspace, ou o instante ISO. */
function fromInstant(value: string, timezone: string): SQL {
  return DATE_ONLY.test(value)
    ? sql`((${value}::date)::timestamp at time zone ${timezone})`
    : sql`${value}::timestamptz`;
}

/** Fim: a data civil é INCLUSIVA (vale até o fim do dia). */
function toInstant(value: string, timezone: string): SQL {
  return DATE_ONLY.test(value)
    ? sql`((${value}::date + 1)::timestamp at time zone ${timezone})`
    : sql`${value}::timestamptz`;
}

export function statusCondition(status: DealStatus): SQL {
  switch (status) {
    case 'open':
      return isNull(deals.closedAt);
    case 'won':
      return and(isNotNull(deals.closedAt), eq(deals.closedWon, true)) as SQL;
    case 'lost':
      return and(isNotNull(deals.closedAt), sql`${deals.closedWon} is not true`) as SQL;
  }
}

/** Centavos inteiros a partir de unidades da moeda. */
export function unitsToCents(units: number): number {
  return Math.round(units * 100);
}

export interface DealWhereOptions {
  /** Status quando o argumento não vem. `null` = sem filtro de status. */
  readonly defaultStatus: DealStatus | null;
  readonly timezone: string;
  /**
   * Expressão de "dias parado" já calculada pelo chamador (ex.: coluna de um `lateral`), para
   * a consulta não repetir a subconsulta por linha. Padrão: `dealIdleDaysSql()` inline.
   */
  readonly idleDays?: SQL;
}

/**
 * Condições de `deals` (workspace + escopo do membro + filtros). Inclui `status` padrão.
 * Exige `deals` no FROM sem alias.
 */
export function buildDealWhere(
  principal: CopilotPrincipal,
  args: DealFilterArgs,
  options: DealWhereOptions,
): SQL {
  const conds: SQL[] = [eq(deals.workspaceId, principal.workspaceId)];
  const scope = dealScope(principal);
  if (scope) conds.push(scope);

  if (args.pipeline_id) conds.push(eq(deals.pipelineId, args.pipeline_id));
  if (args.stage_ids && args.stage_ids.length > 0) {
    conds.push(inArray(deals.stageId, [...args.stage_ids]));
  }
  if (args.owner_id) {
    conds.push(eq(deals.ownerId, args.owner_id === 'me' ? principal.memberId : args.owner_id));
  }
  const status = args.status ?? options.defaultStatus;
  if (status) conds.push(statusCondition(status));
  if (args.value_gte !== undefined) conds.push(gte(deals.valueCents, unitsToCents(args.value_gte)));
  if (args.value_lte !== undefined) conds.push(lte(deals.valueCents, unitsToCents(args.value_lte)));
  if (args.created_from) {
    conds.push(sql`${deals.createdAt} >= ${fromInstant(args.created_from, options.timezone)}`);
  }
  if (args.created_to) {
    conds.push(sql`${deals.createdAt} < ${toInstant(args.created_to, options.timezone)}`);
  }
  if (args.idle_days_gte !== undefined) {
    conds.push(sql`${options.idleDays ?? dealIdleDaysSql()} >= ${args.idle_days_gte}`);
  }
  return and(...conds) as SQL;
}
