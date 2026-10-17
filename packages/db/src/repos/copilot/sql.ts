/**
 * Helpers de SQL dos repos do Copiloto (F73-S01).
 */
import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Coluna SEMPRE qualificada pela tabela (ou pelo alias): `"deals"."conversation_id"`.
 *
 * Por quê: num `select` de tabela única o Drizzle renderiza as colunas da lista de seleção SEM o
 * prefixo da tabela (`buildSelection({ isSingleTable: true })`). Dentro de uma subconsulta
 * correlacionada isso é um bug silencioso: `where m.conversation_id = "conversation_id"` resolve o
 * nome para a tabela de DENTRO (`messages.conversation_id`) e a correlação vira tautologia. Todo
 * fragmento correlacionado destes repos usa este helper.
 */
export function qualified(col: AnyPgColumn): SQL {
  return sql`${sql.identifier(getTableName(col.table))}.${sql.identifier(col.name)}`;
}
