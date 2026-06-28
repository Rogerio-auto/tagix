'use client';

import { useCallback, useState } from 'react';
import { ApiError } from '@/shared/lib/api-client';

/** Estado de um anexo de mídia selecionado pelo agente. */
export interface PendingMedia {
  file: File;
  /** `image` | `video` | `audio` | `file` — derivado do MIME. */
  kind: string;
  /** Object URL local para preview (revogue ao limpar). */
  previewUrl: string;
}

function kindFromMime(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export function mediaFromFile(file: File): PendingMedia {
  return { file, kind: kindFromMime(file.type), previewUrl: URL.createObjectURL(file) };
}

/**
 * Intenção de normalização declarada ao backend via `?as=` (F45-S01):
 * `voice` (áudio → ogg/opus, nota de voz nativa), `sticker` (imagem → webp 512²)
 * ou `auto` (passthrough). Sem o parâmetro o backend assume `auto`.
 */
export type UploadAs = 'voice' | 'sticker' | 'auto';

export interface UploadOptions {
  readonly as?: UploadAs;
}

/** Resultado do upload: URL assinada + MIME APÓS a normalização server-side. */
export interface UploadResult {
  /** URL assinada (7d) que vira a `mediaUrl` da mensagem. */
  readonly url: string;
  /** MIME final (ex.: `audio/ogg` após transcode de voz) — exigido pelo /messages. */
  readonly mime: string;
}

/**
 * Upload de mídia em UM passo (server-side): `POST /api/uploads?filename=<nome>`
 * (`&as=<voice|sticker|auto>`) com o arquivo cru no body → `{ fileUrl, mime }`. A
 * API normaliza quando pedido, sobe no R2 e devolve a URL assinada (7d) + o MIME
 * resultante — ambos viram `mediaUrl`/`mediaMime` da mensagem (o WhatsApp busca via
 * link). Same-origin → o cookie de sessão vai junto. Sem presign de PUT nem CORS.
 *
 * `NEXT_PUBLIC_UPLOAD_MOCK=true` (apenas fora de produção) devolve o object URL
 * local como `mediaUrl` para manter o fluxo navegável sem backend.
 */
export function useMediaUpload() {
  const [uploading, setUploading] = useState(false);

  // Guard duplo: a flag só ativa fora de produção. NODE_ENV é inlined pelo Next
  // no bundle, então o bundler pode tree-shake o branch em prod.
  const uploadMock =
    process.env['NODE_ENV'] !== 'production' &&
    process.env['NEXT_PUBLIC_UPLOAD_MOCK'] === 'true';

  const upload = useCallback(
    async (media: PendingMedia, options?: UploadOptions): Promise<UploadResult> => {
      setUploading(true);
      try {
        const contentType = media.file.type || 'application/octet-stream';
        if (uploadMock) {
          // Stub dev: sem backend de upload, devolve o preview local + MIME de origem.
          return { url: media.previewUrl, mime: contentType };
        }

        // Upload em UM passo: arquivo cru → API (same-origin, cookie de sessão) →
        // R2 → URL assinada. `api` envia JSON, então aqui usamos fetch direto.
        const as = options?.as;
        const asParam = as && as !== 'auto' ? `&as=${as}` : '';
        const res = await fetch(
          `/api/uploads?filename=${encodeURIComponent(media.file.name)}${asParam}`,
          {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: media.file,
            credentials: 'include',
          },
        );
        if (!res.ok) {
          throw new ApiError(res.status, 'Falha ao enviar a mídia.');
        }
        // `mime` reflete o formato após a normalização (ex.: audio/ogg pós-transcode).
        const { fileUrl, mime } = (await res.json()) as { fileUrl: string; mime?: string };
        return { url: fileUrl, mime: mime ?? contentType };
      } finally {
        setUploading(false);
      }
    },
    [uploadMock],
  );

  return { upload, uploading };
}
