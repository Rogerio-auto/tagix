'use client';

import { useCallback, useState } from 'react';
import { api, ApiError } from '@/shared/lib/api-client';

/** Estado de um anexo de mídia selecionado pelo agente. */
export interface PendingMedia {
  file: File;
  /** `image` | `video` | `audio` | `file` — derivado do MIME. */
  kind: string;
  /** Object URL local para preview (revogue ao limpar). */
  previewUrl: string;
}

interface SignResponse {
  /** URL pré-assinada para `PUT` direto no R2. */
  uploadUrl: string;
  /** URL final/assinada que vai no payload da mensagem (mediaUrl). */
  fileUrl: string;
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
 * Upload de mídia via URL assinada (R2).
 *
 * Contrato backend (pendente — ver F1 API de storage/signed-URL):
 *   1. `POST /api/uploads/sign` `{ filename, contentType, size }` → `{ uploadUrl, fileUrl }`.
 *   2. `PUT uploadUrl` com o blob (direto no bucket).
 *   3. `fileUrl` vira `mediaUrl` da mensagem.
 *
 * Enquanto o endpoint não existir, ative o stub com
 * `NEXT_PUBLIC_UPLOAD_MOCK=true` para manter o fluxo navegável (devolve o
 * object URL local como `mediaUrl`). Em produção o stub fica desligado.
 */
export function useMediaUpload() {
  const [uploading, setUploading] = useState(false);

  const uploadMock = process.env['NEXT_PUBLIC_UPLOAD_MOCK'] === 'true';

  const upload = useCallback(
    async (media: PendingMedia): Promise<string> => {
      setUploading(true);
      try {
        if (uploadMock) {
          // Stub: sem backend de signed-URL, devolve o preview local.
          return media.previewUrl;
        }

        const { uploadUrl, fileUrl } = await api.post<SignResponse>('/api/uploads/sign', {
          filename: media.file.name,
          contentType: media.file.type || 'application/octet-stream',
          size: media.file.size,
        });

        const put = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': media.file.type || 'application/octet-stream' },
          body: media.file,
        });
        if (!put.ok) {
          throw new ApiError(put.status, 'Falha ao enviar a mídia para o armazenamento.');
        }
        return fileUrl;
      } finally {
        setUploading(false);
      }
    },
    [uploadMock],
  );

  return { upload, uploading };
}
