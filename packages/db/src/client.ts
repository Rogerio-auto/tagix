import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;

export interface DbClient {
  readonly sql: ReturnType<typeof postgres>;
  readonly db: ReturnType<typeof drizzle<Schema>>;
}

/** Cria uma conexão Postgres + instância Drizzle. postgres.js conecta lazy. */
export function createClient(url = process.env['DATABASE_URL'], max = 20): DbClient {
  if (!url) throw new Error('Variável de ambiente obrigatória ausente: DATABASE_URL');
  const sql = postgres(url, { max });
  return { sql, db: drizzle(sql, { schema }) };
}

let singleton: DbClient | null = null;

/** Instância compartilhada para o processo da app (api/workers). Lazy. */
export function getDb() {
  singleton ??= createClient();
  return singleton.db;
}

export type DB = ReturnType<typeof getDb>;
