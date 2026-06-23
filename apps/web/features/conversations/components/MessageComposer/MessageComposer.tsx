'use client';

import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/api-client';
import { useSendMessage } from '../../queries';
import { mediaFromFile, useMediaUpload, type PendingMedia } from './useMediaUpload';
import { useWindowState } from './useWindowState';
import { WindowNotice } from './WindowNotice';

const MAX_TEXTAREA_HEIGHT = 160; // px — ~7 linhas antes de virar scroll interno.

export interface MessageComposerProps {
  conversationId: string;
  /** Opcional: desabilita o envio manualmente (override do estado de janela). */
  disabled?: boolean;
  /**
   * Disparado quando o agente clica em "Reabrir com template" no bloqueio de
   * janela 24h do WhatsApp (F1-S17). O fluxo de seleção de template é externo
   * ao composer; aqui só sinalizamos a intenção.
   */
  onReopenWithTemplate?: () => void;
  className?: string;
}

export function MessageComposer({
  conversationId,
  disabled = false,
  onReopenWithTemplate,
  className,
}: MessageComposerProps) {
  const { toast } = useToast();
  const send = useSendMessage();
  const { upload, uploading } = useMediaUpload();
  const windowQuery = useWindowState(conversationId);

  // Estado da janela 24h por provider (F1-S17). Enquanto carrega, não bloqueia
  // (otimista: a maioria das conversas está dentro da janela); o backend é a
  // autoridade final no envio. WhatsApp fora da janela trava o composer.
  const windowState = windowQuery.data?.window;
  const windowBlocked = windowState?.requiresTemplate ?? false;

  const [text, setText] = useState('');
  const [media, setMedia] = useState<PendingMedia | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaId = useId();

  const busy = send.isPending || uploading;
  // `disabled` = override manual; `windowBlocked` = WhatsApp fora da janela 24h.
  const inputBlocked = disabled || windowBlocked;
  const blocked = inputBlocked || busy;
  const canSend = !blocked && (text.trim().length > 0 || media !== null);

  // Textarea que cresce com o conteúdo (UX §2 — composer confortável).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  // Limpa o object URL de preview ao trocar/remover o anexo.
  useEffect(() => {
    if (!media) return;
    return () => URL.revokeObjectURL(media.previewUrl);
  }, [media]);

  const resetComposer = () => {
    setText('');
    setMedia(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setMedia(mediaFromFile(file));
  };

  const removeMedia = () => {
    setMedia(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async () => {
    if (!canSend) return;
    const content = text.trim().length > 0 ? text.trim() : null;
    const current = media;

    try {
      let mediaUrl: string | null = null;
      let mediaMime: string | null = null;
      let type = 'text';
      if (current) {
        mediaUrl = await upload(current);
        type = current.kind;
        // O backend exige mediaMime junto da mediaUrl para mídia (o provider precisa
        // do content-type). Sem isto o /messages devolvia 400.
        mediaMime = current.file.type || 'application/octet-stream';
      }
      await send.mutateAsync({ conversationId, content, type, mediaUrl, mediaMime });
      resetComposer();
    } catch (err) {
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Não foi possível enviar',
        description:
          err instanceof ApiError
            ? `${err.message}${ref ? ` (ref ${ref})` : ''}`
            : 'Algo deu errado ao enviar a mensagem. Tente novamente.',
      });
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia; Shift+Enter quebra linha (UX §2.10 — atalhos).
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      aria-busy={busy || undefined}
      className={cn('border-t border-border bg-surface p-3', className)}
    >
      {windowState && (
        <WindowNotice window={windowState} onReopenWithTemplate={onReopenWithTemplate} />
      )}

      {media && (
        <div className="mb-2 flex items-center gap-3 rounded-md border border-border-2 bg-surface-inset p-2">
          {media.kind === 'image' ? (
            // Preview local de object URL (não é recurso remoto → next/image não se aplica).
            <img
              src={media.previewUrl}
              alt={`Pré-visualização de ${media.file.name}`}
              className="size-12 shrink-0 rounded-sm object-cover"
            />
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-surface-3 text-text-mid">
              <Paperclip className="size-5" aria-hidden />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-body text-sm text-text">{media.file.name}</p>
            <p className="font-body text-xs text-text-low">{formatBytes(media.file.size)}</p>
          </div>
          <button
            type="button"
            onClick={removeMedia}
            disabled={busy}
            aria-label="Remover anexo"
            className="rounded-sm p-1.5 text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md disabled:opacity-40"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-md border border-border-2 bg-surface-inset px-2 py-1.5 focus-within:border-border focus-within:shadow-glow-md">
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          onChange={onPickFile}
          disabled={blocked}
          aria-hidden
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={blocked}
          aria-label="Anexar mídia"
          className="mb-0.5 rounded-sm p-2 text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Paperclip className="size-5" aria-hidden />
        </button>

        <label htmlFor={textareaId} className="sr-only">
          Mensagem
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={blocked}
          rows={1}
          placeholder={
            windowBlocked
              ? 'Janela de 24h encerrada — reabra com um template'
              : disabled
                ? 'Envio indisponível para esta conversa'
                : 'Escreva uma mensagem…'
          }
          className="max-h-40 flex-1 resize-none bg-transparent py-1.5 font-body text-sm text-text outline-none placeholder:text-text-low disabled:cursor-not-allowed disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={!canSend}
          aria-label="Enviar mensagem"
          aria-busy={busy || undefined}
          className={cn(
            'mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-md outline-none transition-colors',
            'focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-40',
            canSend ? 'bg-brand text-text-on-brand hover:bg-brand-strong' : 'bg-surface-3 text-text-low',
          )}
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <SendHorizontal className="size-5" aria-hidden />
          )}
        </button>
      </div>
    </form>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
