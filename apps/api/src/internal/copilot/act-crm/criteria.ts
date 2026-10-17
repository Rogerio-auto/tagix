/**
 * Critério legível de uma ação em lote (`impact.criterion`, ≤ 300; F73-S08).
 *
 * É o "porquê destes registros" que a prévia mostra ("Em aberto em Orçamento enviado, cliente
 * sem responder há 7 dias ou mais"). Sai do filtro VALIDADO, nunca do texto do modelo, e só cita
 * nomes da empresa (estágio, funil, membro): nada de contato.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import { makeFormatters, type WorkspaceFormat } from '../read-crm/common';
import type { DealFilterArgs } from '../read-crm/deal-filters';
import { memberNames, plural, sentence } from './common';

const { stages, pipelines } = schema;

const CRITERION_MAX = 300;

function dateLabel(value: string, fmt: WorkspaceFormat): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(fmt.locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: fmt.timezone,
    }).format(d);
  } catch {
    return value.slice(0, 10);
  }
}

/** Critério de um filtro de negócios (o mesmo do `list_deals`). */
export async function describeDealFilter(
  tx: DbTx,
  principal: CopilotPrincipal,
  filter: DealFilterArgs,
  fmt: WorkspaceFormat,
): Promise<string> {
  const f = makeFormatters(fmt);
  const parts: string[] = [];
  const status = filter.status ?? 'open';
  parts.push(status === 'open' ? 'em aberto' : status === 'won' ? 'ganhos' : 'perdidos');

  if (filter.stage_ids && filter.stage_ids.length > 0) {
    const rows = await tx
      .select({ name: stages.name })
      .from(stages)
      .where(
        and(
          eq(stages.workspaceId, principal.workspaceId),
          inArray(stages.id, [...filter.stage_ids]),
        ),
      );
    const names = rows.map((r) => r.name);
    if (names.length > 0) parts[0] = `${parts[0]} em ${names.slice(0, 4).join(', ')}`;
  }
  if (filter.pipeline_id) {
    const [row] = await tx
      .select({ name: pipelines.name })
      .from(pipelines)
      .where(
        and(eq(pipelines.workspaceId, principal.workspaceId), eq(pipelines.id, filter.pipeline_id)),
      )
      .limit(1);
    if (row) parts.push(`no funil ${row.name}`);
  }
  if (filter.idle_days_gte !== undefined) {
    parts.push(
      filter.idle_days_gte === 0
        ? 'qualquer tempo sem resposta'
        : `cliente sem responder há ${plural(filter.idle_days_gte, 'dia', 'dias')} ou mais`,
    );
  }
  if (filter.owner_id) {
    if (filter.owner_id === 'me' || filter.owner_id === principal.memberId) {
      parts.push('seus negócios');
    } else {
      const names = await memberNames(tx, principal.workspaceId, [filter.owner_id]);
      parts.push(`de ${names.get(filter.owner_id) ?? 'outro membro'}`);
    }
  }
  if (filter.value_gte !== undefined) parts.push(`valor a partir de ${f.money(filter.value_gte)}`);
  if (filter.value_lte !== undefined) parts.push(`valor até ${f.money(filter.value_lte)}`);
  if (filter.created_from) parts.push(`criados a partir de ${dateLabel(filter.created_from, fmt)}`);
  if (filter.created_to) parts.push(`criados até ${dateLabel(filter.created_to, fmt)}`);
  return sentence(parts.join(', '), CRITERION_MAX);
}

/** Critério de uma seleção por ids. */
export function describeSelection(count: number, one: string, many: string): string {
  return sentence(
    `${plural(count, one, many)} ${count === 1 ? 'escolhido' : 'escolhidos'} no pedido`,
    CRITERION_MAX,
  );
}
