import { defineConfig } from 'drizzle-kit';

// `generate` não conecta (apenas diffa schema → SQL). A URL fica como fallback
// para comandos que precisem; migrate/seed usam src/migrate.ts e src/seed.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://hm:hm@localhost:5432/highermind',
  },
});
