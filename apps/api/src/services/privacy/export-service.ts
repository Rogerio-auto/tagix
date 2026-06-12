/**
 * Serviço de export LGPD no lado da API (F10-S02). Cria o job assíncrono e lê o
 * status, resolvendo a URL de download assinada quando o artefato está pronto e
 * dentro da validade. A montagem do artefato é do worker (processor); aqui só
 * orquestramos a fila `data_export_jobs` (sob RLS via `tx`).
 */
import type { DataExportJob, DataExportScope, DbTx } from '@hm/db';
import { dataExportJobsRepo } from '@hm/db';
import type { IStorageDriver } from '@hm/storage';

/** TTL da URL assinada de download (curto — o artefato em si expira em `expiresAt`). */
const SIGNED_URL_TTL_SECONDS = 300;

export interface ExportStatusView {
  readonly status: DataExportJob['status'];
  readonly downloadUrl?: string;
  readonly expiresAt?: string;
  readonly error?: string;
}

/** Cria um job `pending` de export. Retorna o id para polling. */
export async function createExportJob(
  tx: DbTx,
  input: { workspaceId: string; requestedBy: string | null; scope: DataExportScope },
): Promise<{ jobId: string }> {
  const job = await dataExportJobsRepo.create(tx, input);
  return { jobId: job.id };
}

/**
 * Lê o status de um job. Se `done` e ainda válido, gera a URL assinada de download
 * (via `@hm/storage`). Se `done` mas expirado, reporta sem URL (link caducou).
 */
export async function getExportStatus(
  tx: DbTx,
  storage: IStorageDriver,
  jobId: string,
  now: Date,
): Promise<ExportStatusView | null> {
  const job = await dataExportJobsRepo.findById(tx, jobId);
  if (!job) return null;

  if (job.status !== 'done' || !job.artifactKey) {
    const view: ExportStatusView = { status: job.status };
    return job.error ? { ...view, error: job.error } : view;
  }

  // Artefato pronto: respeita a validade (expiresAt) antes de assinar a URL.
  const expired = job.expiresAt != null && job.expiresAt.getTime() <= now.getTime();
  if (expired) {
    return { status: 'done', expiresAt: job.expiresAt?.toISOString() };
  }

  const signed = await storage.getSignedUrl(job.artifactKey, SIGNED_URL_TTL_SECONDS);
  return {
    status: 'done',
    downloadUrl: signed.url,
    ...(job.expiresAt ? { expiresAt: job.expiresAt.toISOString() } : {}),
  };
}
