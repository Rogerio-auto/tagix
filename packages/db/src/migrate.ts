/* Aplica as migrations Drizzle no Postgres. Garante a extensão citext antes. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env') });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL ausente — preencha o .env na raiz.');

const sql = postgres(url, { max: 1 });
await sql`CREATE EXTENSION IF NOT EXISTS citext`;
await migrate(drizzle(sql), { migrationsFolder: path.resolve(here, '..', 'drizzle') });
await sql.end();
console.log('[db] migrations aplicadas com sucesso.');
