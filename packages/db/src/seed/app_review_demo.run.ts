/**
 * CLI do seed de demonstração do App Review (F69-S10). Idempotente; só dados fictícios.
 *
 *   pnpm --filter @hm/db exec tsx src/seed/app_review_demo.run.ts --workspace <slug>
 *
 * O workspace já tem que existir — nasce do cadastro normal do app com a conta do revisor
 * (`docs/app-review/conta-de-teste.md`). Guarda de ambiente: `./target-guard`. Contra o banco
 * de produção exige `APP_REVIEW_SEED_ALLOW_REMOTE=1` e
 * `APP_REVIEW_SEED_CONFIRM_DATABASE=<nome do banco>`.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../client';
import { withWorkspace } from '../rls';
import { workspaces } from '../schema';
import { seedAppReviewDemo } from './app_review_demo';
import { assertSeedTarget } from './target-guard';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../../.env') });

const SLUG_RE = /^[a-z0-9-]+$/;

/** `--workspace <slug>` obrigatório (sem default: nunca semear o workspace errado). */
export function parseWorkspaceSlug(argv: readonly string[]): string {
  const i = argv.indexOf('--workspace');
  const raw = i >= 0 ? argv[i + 1] : undefined;
  const slug = raw?.trim() ?? '';
  if (!SLUG_RE.test(slug)) {
    throw new Error('Uso: tsx src/seed/app_review_demo.run.ts --workspace <slug>');
  }
  return slug;
}

async function main(): Promise<void> {
  const slug = parseWorkspaceSlug(process.argv.slice(2));
  const target = assertSeedTarget(process.env, {
    envPrefix: 'APP_REVIEW',
    label: 'o seed de demonstração do App Review',
  });
  console.log(`[app-review] alvo: banco "${target.database}" em ${target.host}`);

  const [ws] = await getDb()
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!ws)
    throw new Error(`Workspace "${slug}" não encontrado. Crie a conta pelo cadastro do app.`);

  const report = await withWorkspace(ws.id, (tx) => seedAppReviewDemo(tx, ws.id));
  const total = Object.values(report.inserted).reduce((a, b) => a + b, 0);
  console.log(`[app-review] seed ok — workspace=${slug} (${ws.name})`);
  console.log(
    total === 0
      ? '[app-review] nada novo (já estava semeado)'
      : `[app-review] inseridos: ${JSON.stringify(report.inserted)}`,
  );
}

/** Só executa como CLI; importar o módulo (teste) não semeia nada. */
function isCliEntry(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  const self = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const invoked = pathToFileURL(path.resolve(entry)).href;
  // Windows: a letra do drive pode vir em caixas diferentes (c: vs C:).
  return process.platform === 'win32'
    ? self.toLowerCase() === invoked.toLowerCase()
    : self === invoked;
}

if (isCliEntry(process.argv[1])) {
  main()
    .catch((err: unknown) => {
      console.error('[app-review] falhou:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
