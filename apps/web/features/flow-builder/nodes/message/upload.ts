/**
 * Upload de midia do node `message` do Flow Builder (F31-S02).
 *
 * SEAM (relatado): nao existe endpoint generico de upload de midia de flow hoje
 * — o pipeline de signed-url existente (`/api/deals/:id/attachments/signed-url`)
 * e deal-scoped e nao serve a flows. Este helper aponta para o endpoint canonico
 * `POST /api/flows/media/signed-url` (workspace-scoped, retorna `{ url, key }`),
 * que AINDA PRECISA SER IMPLEMENTADO no backend. Enquanto nao existir, a chamada
 * falha e o componente degrada para entrada manual de storage key.
 */
import { api } from '@/shared/lib/api-client';

export interface FlowMediaSignedUrl {
  url: string;
  key: string;
}

/** Pede uma signed URL de upload de midia de flow (SEAM: endpoint pendente). */
export function requestFlowMediaUploadUrl(input: {
  filename: string;
  mime: string;
}): Promise<FlowMediaSignedUrl> {
  return api.post<FlowMediaSignedUrl>('/api/flows/media/signed-url', input);
}

/** PUT direto do arquivo na signed URL do storage. */
export async function uploadToSignedUrl(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error(`Falha no upload (${res.status}).`);
}
