'use client';

import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Mic, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/api-client';
import { useSendMessage } from '../../queries';
import { ComposerActionBar, ComposerActionButton, type ComposerActionItem } from './ComposerActionBar';
import { EmojiPicker } from './EmojiPicker';
import { mediaFromFile, useMediaUpload, type PendingMedia } from './useMediaUpload';
import { useVoiceRecorder } from './useVoiceRecorder';
import { VoiceRecorder } from './VoiceRecorder';
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
  const voice = useVoiceRecorder();
  const windowQuery = useWindowState(conversationId);

  // Estado da janela 24h por provider (F1-S17). Enquanto carrega, não bloqueia
  // (otimista: a maioria das conversas está dentro da janela); o backend é a
  // autoridade final no envio. WhatsApp fora da janela trava o composer.
  const windowState = windowQuery.data?.window;
  const windowBlocked = windowState?.requiresTemplate ?? false;

  const [text, setText] = useState('');
  const [media, setMedia] = useState<PendingMedia | null>(null);
  // Persiste enquanto a nota de voz sobe/envia (após `stop`, o gravador já voltou a
  // `idle`) — mantém o estado de gravação montado e em loading até concluir.
  const [voiceSending, setVoiceSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaId = useId();

  // Última seleção conhecida do textarea — preserva a posição do cursor mesmo
  // quando o foco está no popover de emoji (insere no cursor, não no fim).
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  // Caret a aplicar após o próximo render (depois de inserir um emoji).
  const pendingCaretRef = useRef<number | null>(null);

  const busy = send.isPending || uploading;
  // `disabled` = override manual; `windowBlocked` = WhatsApp fora da janela 24h.
  const inputBlocked = disabled || windowBlocked;
  const blocked = inputBlocked || busy;
  const canSend = !blocked && (text.trim().length > 0 || media !== null);

  // Textarea que cresce com o conteúdo (UX §2 — composer confortável). Aplica
  // também o caret pendente de uma inserção de emoji, sem roubar o foco do popover.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    const caret = pendingCaretRef.current;
    if (caret !== null) {
      pendingCaretRef.current = null;
      el.setSelectionRange(caret, caret);
    }
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

  // Mantém a última seleção do textarea para inserir emoji na posição do cursor.
  const rememberSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const focusTextarea = () => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // Insere o emoji no cursor (ou substitui a seleção), avança o caret e mantém o
  // auto-grow. O caret é reaplicado no layout effect — não rouba foco do popover.
  const insertEmoji = (emoji: string) => {
    if (inputBlocked) return;
    const { start, end } = selectionRef.current;
    const safeStart = Math.min(start, text.length);
    const safeEnd = Math.min(end, text.length);
    const next = text.slice(0, safeStart) + emoji + text.slice(safeEnd);
    const caret = safeStart + emoji.length;
    selectionRef.current = { start: caret, end: caret };
    pendingCaretRef.current = caret;
    setText(next);
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
        const uploaded = await upload(current);
        mediaUrl = uploaded.url;
        type = current.kind;
        // O backend exige mediaMime junto da mediaUrl para mídia (o provider precisa
        // do content-type). Usa o MIME pós-normalização que o upload devolve.
        mediaMime = uploaded.mime;
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
    rememberSelection();
    // Enter envia; Shift+Enter quebra linha (UX §2.10 — atalhos).
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  // ── Nota de voz (F45-S04) ───────────────────────────────────────────────────
  // A gravação ocupa um estado dedicado que substitui o input (VoiceRecorder).
  const voiceActive = voice.state !== 'idle' || voiceSending;

  // Encerra a gravação, transcoda no upload (`as: 'voice'`) e envia como `voice`
  // (nota de voz nativa do WhatsApp). `voiceSending` mantém o gravador montado e
  // em loading durante o upload, já que `stop()` devolve o composer a `idle`.
  const sendVoice = async () => {
    setVoiceSending(true);
    let previewUrl: string | null = null;
    try {
      const blob = await voice.stop();
      if (!blob || blob.size === 0) return;
      const ext = blob.type.includes('ogg')
        ? 'ogg'
        : blob.type.includes('mp4')
          ? 'm4a'
          : 'webm';
      const file = new File([blob], `nota-de-voz-${Date.now()}.${ext}`, {
        type: blob.type || 'audio/webm',
      });
      const pending = mediaFromFile(file);
      previewUrl = pending.previewUrl;
      const uploaded = await upload(pending, { as: 'voice' });
      await send.mutateAsync({
        conversationId,
        content: null,
        type: 'voice',
        mediaUrl: uploaded.url,
        mediaMime: uploaded.mime,
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Não foi possível enviar a nota de voz',
        description:
          err instanceof ApiError
            ? `${err.message}${ref ? ` (ref ${ref})` : ''}`
            : 'Algo deu errado ao enviar a nota de voz. Tente novamente.',
      });
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setVoiceSending(false);
    }
  };

  // Barra de ações declarativa. Ponto de extensão das modalidades de envio:
  // S04 (voz), S05 (sticker/localização) e S07 (contato) só acrescentam itens
  // aqui — sem reescrever o composer nem a barra (scaffold-then-fill, F45).
  const actions: ComposerActionItem[] = [
    {
      id: 'attach',
      node: (
        <ComposerActionButton
          icon={<Paperclip className="size-5" aria-hidden />}
          label="Anexar mídia"
          disabled={blocked}
          onClick={() => fileInputRef.current?.click()}
        />
      ),
    },
    {
      id: 'emoji',
      node: <EmojiPicker onSelect={insertEmoji} disabled={blocked} onClosed={focusTextarea} />,
    },
    {
      id: 'voice',
      node: (
        <ComposerActionButton
          icon={<Mic className="size-5" aria-hidden />}
          label="Gravar nota de voz"
          disabled={blocked || voiceActive}
          onClick={() => void voice.start()}
        />
      ),
    },
  ];

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

      <div
        className={cn(
          'flex gap-2 rounded-md border border-border-2 bg-surface-inset px-2 py-1.5',
          'focus-within:border-border focus-within:shadow-glow-md',
          voiceActive ? 'items-center' : 'items-end',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          onChange={onPickFile}
          disabled={blocked}
          aria-hidden
          tabIndex={-1}
        />

        {voiceActive ? (
          <VoiceRecorder
            state={voice.state}
            elapsedMs={voice.elapsedMs}
            analyser={voice.analyser}
            error={voice.error}
            busy={voiceSending}
            onCancel={voice.cancel}
            onSend={() => void sendVoice()}
          />
        ) : (
          <>
            <ComposerActionBar actions={actions} />

            <label htmlFor={textareaId} className="sr-only">
              Mensagem
            </label>
            <textarea
              id={textareaId}
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                rememberSelection();
              }}
              onKeyDown={onKeyDown}
              onKeyUp={rememberSelection}
              onClick={rememberSelection}
              onSelect={rememberSelection}
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
                canSend
                  ? 'bg-brand text-text-on-brand hover:bg-brand-strong'
                  : 'bg-surface-3 text-text-low',
              )}
            >
              {busy ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <SendHorizontal className="size-5" aria-hidden />
              )}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
