'use client';

import type { ReactNode } from 'react';
import { AudioLines, FileText, ImageIcon, Mic, Video } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { AudioMessageKind, MessageType } from './types';

export interface MessagePreviewData {
  messageType: MessageType;
  text?: string;
  caption?: string;
  filename?: string;
  /** Object URL local (preview de imagem recem-enviada). */
  previewUrl?: string;
  audioMessageKind?: AudioMessageKind;
}

/** Realça tokens `{{var}}` no texto/legenda para leitura WYSIWYG. */
function renderInterpolated(text: string): ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) =>
    /^\{\{[^}]+\}\}$/.test(part) ? (
      <span
        key={`${i}-${part}`}
        className="rounded-sm bg-accent/15 px-1 font-mono text-[0.85em] text-accent"
      >
        {part}
      </span>
    ) : (
      <span key={`${i}-${part}`}>{part}</span>
    ),
  );
}

function MediaThumb({ data }: { data: MessagePreviewData }) {
  if (data.messageType === 'image' && data.previewUrl) {
    return (
      // previewUrl é um object URL local (não passa pelo otimizador do Next) → <img> simples.
      <img
        src={data.previewUrl}
        alt={data.filename ?? 'Pré-visualização da imagem'}
        loading="lazy"
        className="max-h-40 w-full rounded-md object-cover"
      />
    );
  }

  const config: Record<
    'image' | 'video' | 'document' | 'voice' | 'audio_file',
    { icon: typeof ImageIcon; label: string }
  > = {
    image: { icon: ImageIcon, label: 'Imagem' },
    video: { icon: Video, label: 'Vídeo' },
    document: { icon: FileText, label: data.filename ?? 'Documento' },
    voice: { icon: Mic, label: 'Nota de voz' },
    audio_file: { icon: AudioLines, label: data.filename ?? 'Áudio' },
  };

  const key =
    data.messageType === 'audio'
      ? data.audioMessageKind === 'voice'
        ? 'voice'
        : 'audio_file'
      : data.messageType === 'video'
        ? 'video'
        : data.messageType === 'document'
          ? 'document'
          : 'image';

  const { icon: Icon, label } = config[key];

  if (key === 'voice') {
    return (
      <div className="flex items-center gap-2 rounded-md bg-surface-1/60 px-2 py-2">
        <Icon className="size-4 shrink-0 text-accent" aria-hidden />
        <div className="flex flex-1 items-center gap-0.5" aria-hidden>
          {[3, 6, 9, 5, 8, 4, 7, 3, 6, 9, 4].map((h, i) => (
            <span
              key={`${i}-${h}`}
              className="w-0.5 rounded-full bg-text-low"
              style={{ height: `${h * 2}px` }}
            />
          ))}
        </div>
        <span className="shrink-0 text-[11px] text-text-low">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-surface-1/60 px-2.5 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text-mid">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="truncate text-xs text-text-mid">{label}</span>
    </div>
  );
}

/**
 * Bolha de pré-visualização (WYSIWYG) da mensagem outbound (F31-S02). Espelha o
 * que o contato verá: texto, mídia + legenda, nota de voz ou áudio-arquivo.
 */
export function MessageBubblePreview({ data }: { data: MessagePreviewData }) {
  const hasText = Boolean(data.text?.trim());
  const hasCaption = Boolean(data.caption?.trim());
  const isMedia = data.messageType !== 'text';
  const empty = !hasText && !hasCaption && !isMedia;

  return (
    <div className="rounded-lg border border-border-2 bg-surface-2 p-3">
      <div className="ml-auto max-w-[85%]">
        <div
          className={cn(
            'rounded-2xl rounded-br-sm border border-accent/20 bg-accent/10 px-3 py-2 text-sm text-text shadow-sm',
            empty && 'text-text-low',
          )}
        >
          {empty ? (
            <span className="italic">Sua mensagem aparece aqui…</span>
          ) : (
            <div className="flex flex-col gap-2">
              {isMedia && <MediaThumb data={data} />}
              {data.messageType === 'text' && hasText && (
                <p className="whitespace-pre-wrap break-words">
                  {renderInterpolated(data.text ?? '')}
                </p>
              )}
              {isMedia && hasCaption && (
                <p className="whitespace-pre-wrap break-words text-[13px]">
                  {renderInterpolated(data.caption ?? '')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
