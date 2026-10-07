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
import { assertSeedTarget, isProductionDatabaseName, type SeedTarget } from './target-guard';

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

export { isProductionDatabaseName, type SeedTarget };

/**
 * Guarda do seed (F70-S18): a regra mora em `./target-guard` (comum aos seeds de um
 * workspace); aqui só os nomes `ARCADA_SEED_ALLOW_REMOTE` / `ARCADA_SEED_CONFIRM_DATABASE`.
 */
export function assertSeedTargetAllowed(env: SeedTargetEnv): SeedTarget {
  return assertSeedTarget({ ...env }, { envPrefix: 'ARCADA', label: 'o seed da Arcada' });
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
      `[arcada] prompt ou modelo mudou: v${report.draftPromptVersion} gravada como RASCUNHO (live intacto).`,
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
  const prefilled = Object.keys(report.prefilledForApproval);
  console.log(
    `[arcada] pré-preenchidos, aguardando aprovação (${prefilled.length}): ${prefilled.join(', ')}`,
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
