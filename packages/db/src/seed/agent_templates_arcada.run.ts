/**
 * CLI do seed da Arcada (F70-S06). Idempotente; não ativa nada.
 *
 *   pnpm --filter @hm/db exec tsx src/seed/agent_templates_arcada.run.ts --workspace <slug>
 *
 * Guarda de ambiente: só roda contra Postgres local (localhost/127.0.0.1) a menos que
 * `ARCADA_SEED_ALLOW_REMOTE=1` esteja setado de propósito (produção é decisão do Rogério).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

function assertLocalDatabase(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL ausente.');
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local && process.env['ARCADA_SEED_ALLOW_REMOTE'] !== '1') {
    throw new Error(
      `Banco não-local (${host}). Para rodar fora do dev, defina ARCADA_SEED_ALLOW_REMOTE=1 conscientemente.`,
    );
  }
}

async function main(): Promise<void> {
  const slug = parseWorkspaceSlug(process.argv.slice(2));
  assertLocalDatabase(process.env['DATABASE_URL']);

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

main()
  .catch((err: unknown) => {
    console.error('[arcada] falhou:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
