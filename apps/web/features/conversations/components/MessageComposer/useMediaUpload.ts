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
 * Upload de mídia em UM passo (server-side): `POST /api/uploads?filename=<nome>`
 * com o arquivo cru no body → `{ fileUrl }`. A API sobe no R2 e devolve a URL
 * assinada (7d), que vira a `mediaUrl` da mensagem (o WhatsApp busca via link).
 * Same-origin → o cookie de sessão vai junto. Sem presign de PUT nem CORS de R2.
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
    async (media: PendingMedia): Promise<string> => {
      setUploading(true);
      try {
        if (uploadMock) {
          // Stub dev: sem backend de upload, devolve o preview local.
          return media.previewUrl;
        }

        // Upload em UM passo: arquivo cru → API (same-origin, cookie de sessão) →
        // R2 → URL assinada. `api` envia JSON, então aqui usamos fetch direto.
        const res = await fetch(`/api/uploads?filename=${encodeURIComponent(media.file.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': media.file.type || 'application/octet-stream' },
          body: media.file,
          credentials: 'include',
        });
        if (!res.ok) {
          throw new ApiError(res.status, 'Falha ao enviar a mídia.');
        }
        const { fileUrl } = (await res.json()) as { fileUrl: string };
        return fileUrl;
      } finally {
        setUploading(false);
      }
    },
    [uploadMock],
  );

  return { upload, uploading };
}
