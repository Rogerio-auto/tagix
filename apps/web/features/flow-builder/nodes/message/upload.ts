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
  /**
   * MIME REAL pós-normalização do servidor (ex.: `audio/ogg` quando `intent='voice'`).
   * Vira o `mediaType` do node — não confie no `file.type` do browser.
   */
  mime: string;
}

/**
 * Intenção de normalização do upload (espelha `as` da rota `POST /api/uploads`):
 *   - `voice` → transcode ffmpeg p/ `audio/ogg;codecs=opus` (nota de voz nativa, Meta 131053);
 *   - `auto`  → passthrough (comportamento legado).
 */
export type FlowMediaIntent = 'voice' | 'auto';

/** Sobe um arquivo de mídia de flow e devolve a storage key + URL de leitura + MIME do servidor. */
export async function uploadFlowMedia(
  file: File,
  intent: FlowMediaIntent = 'auto',
): Promise<FlowMediaUploaded> {
  const params = new URLSearchParams({ filename: file.name });
  if (intent !== 'auto') params.set('as', intent);
  const res = await fetch(`/api/uploads?${params.toString()}`, {
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
