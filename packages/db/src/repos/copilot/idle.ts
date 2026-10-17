/**
 * Régua única de "negócio parado" (F73-S01). Usada pelas consultas do Copiloto (S06), pelo
 * briefing (S12) e pelo piloto automático (S13): os três precisam dar o MESMO número para o
 * mesmo negócio, então a definição mora aqui, uma vez.
 *
 * - `dealIdleDaysSql()`: dias inteiros (piso, ≥ 0) desde a última mensagem DO CONTATO
 *   (`direction='inbound'`) na conversa vinculada ao negócio. Sem conversa, ou sem nenhuma
 *   mensagem do contato nela, conta desde `deals.updated_at` (ou `created_at`, se nunca editado).
 * - `dealLastMessageDirectionSql()`: direção da última mensagem da conversa vinculada
 *   (`'inbound' | 'outbound'`), ou NULL sem conversa/sem mensagem. O piloto usa
 *   `= 'outbound'` para "a última mensagem foi nossa".
 *
 * O instante da mensagem é `coalesce(provider_timestamp, created_at)` — a mesma expressão do
 * índice `idx_messages_conversation_provider_ts (conversation_id, coalesce(...) DESC)`, então as
 * subconsultas são uma descida de índice por negócio. Sob `withWorkspace` a RLS de `messages`
 * também vale.
 *
 * Os fragmentos são correlacionados às colunas passadas (padrão: a tabela `deals`); para usar com
 * alias, passe as colunas do alias (`alias(deals, 'd')`). As colunas saem sempre qualificadas
 * (`qualified`), então funcionam na lista de seleção de um `select` de tabela única.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { deals } from '../../schema/pipeline';
import { qualified } from './sql';

export interface DealIdleColumns {
  readonly conversationId: AnyPgColumn;
  readonly updatedAt: AnyPgColumn;
  readonly createdAt: AnyPgColumn;
}

export type DealLastMessageDirection = 'inbound' | 'outbound';

const DEFAULT_COLUMNS: DealIdleColumns = {
  conversationId: deals.conversationId,
  updatedAt: deals.updatedAt,
  createdAt: deals.createdAt,
};

/** Instante da última mensagem do contato na conversa do negócio (NULL se não houver). */
export function dealLastInboundAtSql(cols: DealIdleColumns = DEFAULT_COLUMNS): SQL<Date | null> {
  return sql<Date | null>`(
    select coalesce(idle_m.provider_timestamp, idle_m.created_at)
      from messages idle_m
     where idle_m.conversation_id = ${qualified(cols.conversationId)}
       and idle_m.direction = 'inbound'
     order by coalesce(idle_m.provider_timestamp, idle_m.created_at) desc
     limit 1
  )`;
}

/**
 * Dias parado (inteiro ≥ 0). `now` padrão: `now()` da transação; passe outro instante para
 * cálculo reprodutível (testes, relatórios "na data X").
 */
export function dealIdleDaysSql(
  cols: DealIdleColumns = DEFAULT_COLUMNS,
  now: SQL = sql`now()`,
): SQL<number> {
  return sql<number>`greatest(0, floor(extract(epoch from (${now} - coalesce(
    ${dealLastInboundAtSql(cols)},
    ${qualified(cols.updatedAt)},
    ${qualified(cols.createdAt)}
  ))) / 86400))::int`.mapWith(Number);
}

/** Direção da última mensagem da conversa do negócio, ou NULL. */
export function dealLastMessageDirectionSql(
  cols: DealIdleColumns = DEFAULT_COLUMNS,
): SQL<DealLastMessageDirection | null> {
  return sql<DealLastMessageDirection | null>`(
    select idle_d.direction
      from messages idle_d
     where idle_d.conversation_id = ${qualified(cols.conversationId)}
     order by coalesce(idle_d.provider_timestamp, idle_d.created_at) desc, idle_d.id desc
     limit 1
  )`;
}
