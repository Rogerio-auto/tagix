'use client';

/**
 * Painel de envio de sticker (F45-S05), embutido no `AttachmentMenu`. O agente
 * escolhe uma imagem → o upload a normaliza para webp 512² no servidor
 * (`as: 'sticker'`, F45-S01) → preview do PRÓPRIO webp resultante → envia como
 * `type:'sticker'` (mídia, sem legenda). Ver o webp antes de confirmar evita
 * surpresa de recorte/conversão (UX §2 — feedback imediato e honesto).
 *
 * DS v2: zero hex, só tokens; foco `focus-visible:shadow-glow-md`; alvo ≥44px.
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, RefreshCw, SendHorizontal } from 'lucide-react';
import { useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/api-client';
import { useSendMessage } from '../../queries';
import { mediaFromFile, useMediaUpload, type PendingMedia } from './useMediaUpload';

export interface StickerPickerProps {
  readonly conversationId: string;
  /** Fecha o menu de anexo após o envio bem-sucedido. */
  readonly onSent: () => void;
}

export function StickerPicker({ conversationId, onSent }: StickerPickerProps) {
  const { toast } = useToast();
  const send = useSendMessage();
  const { upload, uploading } = useMediaUpload();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<PendingMedia | null>(null);
  const [uploaded, setUploaded] = useState<{ url: string; mime: string } | null>(null);
  const [failed, setFailed] = useState(false);

  // Revoga o object URL da imagem de origem ao trocar/desmontar.
  useEffect(() => {
    if (!source) return;
    return () => URL.revokeObjectURL(source.previewUrl);
  }, [source]);

  const runUpload = async (media: PendingMedia) => {
    setFailed(false);
    try {
      // `as: 'sticker'` → o backend converte a imagem em webp 512² e devolve a
      // URL assinada do resultado, que pré-visualizamos antes de enviar.
      const result = await upload(media, { as: 'sticker' });
      setUploaded(result);
    } catch (err) {
      setFailed(true);
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Não foi possível gerar o sticker',
        description:
          err instanceof ApiError
            ? `${err.message}${ref ? ` (ref ${ref})` : ''}`
            : 'Tente novamente com outra imagem.',
      });
    }
  };

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const media = mediaFromFile(file);
    if (media.kind !== 'image') {
      URL.revokeObjectURL(media.previewUrl);
      toast({
        variant: 'error',
        title: 'Formato inválido',
        description: 'Escolha uma imagem (PNG ou JPG) para enviar como sticker.',
      });
      return;
    }
    setSource(media);
    setUploaded(null);
    void runUpload(media);
  };

  const submit = async () => {
    if (!uploaded || send.isPending) return;
    try {
      await send.mutateAsync({
        conversationId,
        content: null,
        type: 'sticker',
        mediaUrl: uploaded.url,
        mediaMime: uploaded.mime,
      });
      onSent();
    } catch (err) {
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Não foi possível enviar o sticker',
        description:
          err instanceof ApiError
            ? `${err.message}${ref ? ` (ref ${ref})` : ''}`
            : 'Algo deu errado ao enviar. Tente novamente.',
      });
    }
  };

  const sending = send.isPending;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onPickFile}
        tabIndex={-1}
        aria-hidden
      />

      {source === null ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex min-h-[7rem] w-full flex-col items-center justify-center gap-2 rounded-md',
            'border border-dashed border-border-2 bg-surface-inset px-3 py-4 text-text-mid outline-none',
            'transition-colors hover:border-border hover:text-text focus-visible:shadow-glow-md',
          )}
        >
          <ImagePlus className="size-6" aria-hidden />
          <span className="font-body text-sm">Escolher imagem</span>
          <span className="font-body text-xs text-text-low">Vira um sticker webp 512²</span>
        </button>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="grid size-32 place-items-center rounded-md border border-border-2 bg-surface-inset p-2">
            {uploading ? (
              <span className="flex flex-col items-center gap-2 text-text-mid" role="status" aria-live="polite">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                <span className="font-body text-xs">Gerando sticker…</span>
              </span>
            ) : failed ? (
              <button
                type="button"
                onClick={() => void runUpload(source)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-danger outline-none',
                  'transition-colors hover:bg-surface focus-visible:shadow-glow-md',
                )}
              >
                <RefreshCw className="size-5" aria-hidden />
                <span className="font-body text-xs">Falhou — tentar de novo</span>
              </button>
            ) : uploaded ? (
              // Preview do webp 512² já gerado pelo servidor (recurso remoto R2 → <img> simples).
              <img
                src={uploaded.url}
                alt="Pré-visualização do sticker"
                className="size-full object-contain"
              />
            ) : null}
          </div>

          <div className="flex w-full items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className={cn(
                'flex-1 rounded-md border border-border-2 px-3 py-2 font-body text-sm text-text-mid outline-none',
                'transition-colors hover:bg-surface-3 hover:text-text focus-visible:shadow-glow-md',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              Trocar
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!uploaded || sending}
              aria-busy={sending || undefined}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 font-body text-sm outline-none',
                'transition-colors focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40',
                uploaded && !sending
                  ? 'bg-brand text-text-on-brand hover:bg-brand-strong'
                  : 'bg-surface-3 text-text-low',
              )}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <SendHorizontal className="size-4" aria-hidden />
              )}
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
