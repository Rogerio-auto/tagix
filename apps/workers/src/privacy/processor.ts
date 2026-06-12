/**
 * Processador de jobs de export LGPD (F10-S02).
 *
 * Drena `data_export_jobs` com status `pending` e, para cada um:
 *   1. claim otimista (`pending → processing`) sob a RLS do tenant;
 *   2. coleta a PII do scope (também sob RLS);
 *   3. grava o artefato JSON via `@hm/storage` (chave por workspace/job);
 *   4. marca `done` com a chave do artefato + `expires_at` (link expira).
 * Falhas marcam `failed` com a mensagem.
 *
 * Descoberta de jobs roda como owner (`getDb()`) — varredura de plataforma sobre a
 * fila de todos os tenants, lendo só `id`/`workspace_id`/`scope` (sem PII). Todo o
 * resto (claim/collect/persist) roda DENTRO de `withWorkspace(job.workspaceId, ...)`,
 * então nada cruza tenant: o claim sob RLS recusa jobs de outro workspace.
 */
import { Buffer } from 'node:buffer';
import { asc, eq } from 'drizzle-orm';
import { dataExportJobsRepo, getDb, schema, withWorkspace, type DataExportScope } from '@hm/db';
import type { IStorageDriver } from '@hm/storage';
import type { Logger } from '@hm/logger';
import { collectExport } from './collect';

const { dataExportJobs } = schema;

/** Quantos jobs por tick (evita varredura ilimitada). */
const BATCH_SIZE = 10;
/** Validade do artefato/link (7 dias). */
export const ARTIFACT_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ProcessDeps {
  readonly storage: IStorageDriver;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export interface ProcessTickResult {
  readonly processed: number;
  readonly done: number;
  readonly failed: number;
}

interface PendingJobRef {
  readonly id: string;
  readonly workspaceId: string;
  readonly scope: DataExportScope;
}

/** Chave do objeto no storage para o artefato de um job. */
export function artifactKey(workspaceId: string, jobId: string): string {
  return `lgpd-exports/${workspaceId}/${jobId}.json`;
}

/** Processa um lote de jobs pendentes. Idempotente: o claim sob RLS evita corrida. */
export async function processPendingExports(deps: ProcessDeps): Promise<ProcessTickResult> {
  const now = deps.now ?? (() => new Date());

  // Descoberta (owner): só metadados, sem PII.
  const refs = await getDb()
    .select({
      id: dataExportJobs.id,
      workspaceId: dataExportJobs.workspaceId,
      scope: dataExportJobs.scope,
    })
    .from(dataExportJobs)
    .where(eq(dataExportJobs.status, 'pending'))
    .orderBy(asc(dataExportJobs.createdAt))
    .limit(BATCH_SIZE);

  let done = 0;
  let failed = 0;

  for (const ref of refs as PendingJobRef[]) {
    const outcome = await processOne(ref, deps, now);
    if (outcome === 'done') done += 1;
    else if (outcome === 'failed') failed += 1;
  }

  return { processed: refs.length, done, failed };
}

async function processOne(
  ref: PendingJobRef,
  deps: ProcessDeps,
  now: () => Date,
): Promise<'done' | 'failed' | 'skipped'> {
  const startedAt = now();
  try {
    // Claim + coleta sob a RLS do tenant. Se outro worker já pegou, claim retorna null.
    const collected = await withWorkspace(ref.workspaceId, async (tx) => {
      const claimed = await dataExportJobsRepo.claim(tx, ref.id, startedAt);
      if (!claimed) return null;
      const artifact = await collectExport(tx, ref.workspaceId, claimed.scope, startedAt);
      return artifact;
    });
    if (!collected) return 'skipped';

    // Persiste o artefato fora da transação (I/O de storage). A chave é determinística.
    const key = artifactKey(ref.workspaceId, ref.id);
    const body = Buffer.from(JSON.stringify(collected, null, 2), 'utf8');
    await deps.storage.put({ key, body: new Uint8Array(body), contentType: 'application/json' });

    const completedAt = now();
    const expiresAt = new Date(completedAt.getTime() + ARTIFACT_TTL_SECONDS * 1000);
    await withWorkspace(ref.workspaceId, (tx) =>
      dataExportJobsRepo.markDone(tx, ref.id, {
        artifactKey: key,
        artifactBytes: body.byteLength,
        expiresAt,
        completedAt,
      }),
    );
    deps.logger.info('export LGPD concluído', {
      jobId: ref.id,
      workspaceId: ref.workspaceId,
      bytes: body.byteLength,
    });
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.error('export LGPD falhou', { jobId: ref.id, error: message });
    try {
      await withWorkspace(ref.workspaceId, (tx) =>
        dataExportJobsRepo.markFailed(tx, ref.id, message, now()),
      );
    } catch {
      // Best-effort: se nem o mark-failed funcionar, o job fica em processing e será
      // reavaliado por um operador (não silenciamos o erro original — já logado).
    }
    return 'failed';
  }
}
