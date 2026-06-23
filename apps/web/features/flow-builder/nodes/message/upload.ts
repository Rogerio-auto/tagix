/**
 * Upload de mídia do node `message` do Flow Builder.
 *
 * Reutiliza o pipeline server-side EXISTENTE `POST /api/uploads?filename=<nome>` (o mesmo
 * do MessageComposer do LiveChat): o arquivo cru sobe same-origin (cookie de sessão) → API
 * → R2 e volta `{ key, fileUrl }`. Em UM passo — sem CORS/presign de PUT no R2. O flow
 * guarda a `key` em `mediaStorageKey`; o outbound publisher resolve a signed URL no envio.
 *
 * (Antes apontava para `POST /api/flows/media/signed-url`, um SEAM que nunca foi
 * implementado no backend — daí o 404 ao anexar mídia no Flow Builder.)
 */

export interface FlowMediaUploaded {
  /** Storage key canônica — vai em `mediaStorageKey` do node. */
  key: string;
  /** URL assinada de leitura (preview imediato). */
  fileUrl: string;
}

/** Sobe um arquivo de mídia de flow e devolve a storage key + URL de leitura. */
export async function uploadFlowMedia(file: File): Promise<FlowMediaUploaded> {
  const res = await fetch(`/api/uploads?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(
      res.status === 415 ? 'Tipo de arquivo não suportado.' : `Falha no upload (${res.status}).`,
    );
  }
  return (await res.json()) as FlowMediaUploaded;
}
