import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;

export interface DbClient {
  readonly sql: ReturnType<typeof postgres>;
  readonly db: ReturnType<typeof drizzle<Schema>>;
}

/**
 * Tipos de data cujo serializador o driver `drizzle-orm/postgres-js` troca por um repasse:
 * `timestamptz` (1184 — o que o postgres.js infere para um `Date`), `timestamp` (1114) e
 * `date` (1082).
 */
const DATE_TYPE_OIDS = ['1184', '1114', '1082'] as const;

/** Converte só `Date`. Texto passa intacto — preserva os microssegundos que um `Date` perderia. */
function serializeDateParam(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Cria uma conexão Postgres + instância Drizzle. postgres.js conecta lazy.
 *
 * ## Por que o serializador de data é devolvido depois do `drizzle()` (F2-S22)
 *
 * Ao construir, o Drizzle substitui o serializador dos tipos de data por um repasse, porque as
 * colunas tipadas já mandam texto. Um `${data}` dentro de `sql` cru não passa por coluna: o
 * postgres.js infere `timestamptz`, aplica o repasse e tenta escrever o objeto `Date` no
 * protocolo — `TypeError`. Assim o rollup de métricas e a recorrência PIX falharam em todo tick
 * de produção. A ordem importa: antes do `drizzle()`, a troca apagaria esta correção.
 */
export function createClient(url = process.env['DATABASE_URL'], max = 20): DbClient {
  if (!url) throw new Error('Variável de ambiente obrigatória ausente: DATABASE_URL');
  const sql = postgres(url, { max });
  const db = drizzle(sql, { schema });
  for (const oid of DATE_TYPE_OIDS) sql.options.serializers[oid] = serializeDateParam;
  return { sql, db };
}

let singleton: DbClient | null = null;

/** Instância compartilhada para o processo da app (api/workers). Lazy. */
export function getDb() {
  singleton ??= createClient();
  return singleton.db;
}

/** Encerra a conexão compartilhada (testes / shutdown). */
export async function closeDb(): Promise<void> {
  if (singleton) {
    await singleton.sql.end();
    singleton = null;
  }
}

export type DB = ReturnType<typeof getDb>;
export type DbTx = Parameters<Parameters<DB['transaction']>[0]>[0];
