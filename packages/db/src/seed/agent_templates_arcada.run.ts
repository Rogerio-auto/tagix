/**
 * CLI do seed da Arcada (F70-S06). Idempotente; não ativa nada.
 *
 *   pnpm --filter @hm/db exec tsx src/seed/agent_templates_arcada.run.ts --workspace <slug>
 *
 * Guarda de ambiente (`assertSeedTargetAllowed`, F70-S18): ver a função. Em resumo, recusa
 * `NODE_ENV=production` sempre e só roda sozinha contra banco LOCAL cujo NOME não é de
 * produção. Fora disso exige dupla confirmação consciente (produção é decisão do Rogério).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../client';
import { withWorkspace } from '../rls';
import { workspaces } from '../schema';
import { seedArcadaAttendance } from './agent_templates_arcada';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../../.env') });

const SLUG_RE = /^[a-z0-9-]+$/;

/** `--workspace <slug>` obrigatório (sem default: nunca semear o workspace errado). */
function parseWorkspaceSlug(argv: readonly string[]): string {
  const i = argv.indexOf('--workspace');
  const raw = i >= 0 ? argv[i + 1] : undefined;
  const slug = raw?.trim() ?? '';
  if (!SLUG_RE.test(slug)) {
    throw new Error('Uso: tsx src/seed/agent_templates_arcada.run.ts --workspace <slug>');
  }
  return slug;
}

/** Variáveis de ambiente que a guarda lê (injetáveis no teste). */
export interface SeedTargetEnv {
  readonly NODE_ENV?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly ARCADA_SEED_ALLOW_REMOTE?: string | undefined;
  readonly ARCADA_SEED_CONFIRM_DATABASE?: string | undefined;
}

export interface SeedTarget {
  readonly host: string;
  readonly database: string;
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Nomes de banco de produção. `leadium` é o `PG_DB` de `.env.production.example`; qualquer
 * nome com `prod` também conta. Hostname sozinho não basta: um túnel SSH para a VPS aparece
 * como `localhost`, e é o nome do banco que denuncia o alvo.
 */
const PRODUCTION_DATABASE_NAMES: ReadonlySet<string> = new Set(['leadium']);
const PRODUCTION_DATABASE_RE = /prod/i;

export function isProductionDatabaseName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return PRODUCTION_DATABASE_NAMES.has(n) || PRODUCTION_DATABASE_RE.test(n);
}

/**
 * Guarda do seed (F70-S18). Lança com a razão; devolve o alvo quando pode rodar.
 *
 * 1. `NODE_ENV=production` → recusa SEMPRE (sem escape: o seed não é passo de deploy).
 * 2. `DATABASE_URL` ausente, ilegível ou sem nome de banco → recusa (não dá para confirmar).
 * 3. Banco local E nome que não é de produção → roda.
 * 4. Qualquer outro caso (host remoto, OU nome de produção mesmo em `localhost`) exige as
 *    DUAS confirmações: `ARCADA_SEED_ALLOW_REMOTE=1` e `ARCADA_SEED_CONFIRM_DATABASE=<nome
 *    exato do banco>`. Digitar o nome do banco é a prova de que se sabe onde se está.
 */
export function assertSeedTargetAllowed(env: SeedTargetEnv): SeedTarget {
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new Error('NODE_ENV=production: o seed da Arcada não roda em ambiente de produção.');
  }
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new Error('DATABASE_URL ausente.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL ilegível.');
  }
  const host = url.hostname.toLowerCase();
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim();
  } catch {
    throw new Error('DATABASE_URL com nome de banco ilegível.');
  }
  if (database === '') {
    throw new Error('DATABASE_URL sem nome de banco: não dá para confirmar o alvo.');
  }

  const local = LOCAL_HOSTS.has(host);
  const productionName = isProductionDatabaseName(database);
  if (local && !productionName) return { host, database };

  const why = productionName
    ? `Banco "${database}" tem nome de produção`
    : `Banco não-local (${host})`;
  const allowed = env.ARCADA_SEED_ALLOW_REMOTE === '1';
  const confirmed = env.ARCADA_SEED_CONFIRM_DATABASE === database;
  if (!allowed || !confirmed) {
    throw new Error(
      `${why}. Para rodar mesmo assim, defina ARCADA_SEED_ALLOW_REMOTE=1 e ` +
        `ARCADA_SEED_CONFIRM_DATABASE=<nome exato do banco>, conscientemente.`,
    );
  }
  return { host, database };
}

async function main(): Promise<void> {
  const slug = parseWorkspaceSlug(process.argv.slice(2));
  const target = assertSeedTargetAllowed(process.env);
  console.log(`[arcada] alvo: banco "${target.database}" em ${target.host}`);

  const [ws] = await getDb()
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!ws) throw new Error(`Workspace "${slug}" não encontrado.`);

  const report = await withWorkspace(ws.id, (tx) => seedArcadaAttendance(tx, ws.id));

  console.log(`[arcada] seed ok — workspace=${slug} (${ws.name})`);
  console.log(
    `[arcada] criado nesta execução: ${report.created.length ? report.created.join(', ') : 'nada (idempotente)'}`,
  );
  if (report.draftPromptVersion !== null) {
    console.log(
      `[arcada] prompt mudou: v${report.draftPromptVersion} gravada como RASCUNHO (live intacto).`,
    );
  }
  console.log(
    `[arcada] agente ${report.agentId} (inativo) | flows em rascunho: ${report.flowIds.activation}, ${report.flowIds.cadence}`,
  );
  console.log(`[arcada] tools vinculadas: ${report.linkedTools.join(', ') || 'nenhuma'}`);
  for (const w of report.warnings) console.warn(`[arcada] AVISO: ${w}`);
  console.log(
    `[arcada] marcadores a preencher (${report.pendingMarkers.length}): ${report.pendingMarkers.join(', ')}`,
  );
}

/** Só executa como CLI; importar o módulo (teste da guarda) não semeia nada. */
function isCliEntry(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  const self = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const invoked = pathToFileURL(path.resolve(entry)).href;
  // Windows: a letra do drive pode vir em caixas diferentes (c: vs C:).
  return process.platform === 'win32'
    ? self.toLowerCase() === invoked.toLowerCase()
    : self === invoked;
}
const isCli = isCliEntry(process.argv[1]);

if (isCli) {
  main()
    .catch((err: unknown) => {
      console.error('[arcada] falhou:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
