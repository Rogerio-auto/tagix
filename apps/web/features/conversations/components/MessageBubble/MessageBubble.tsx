/**
 * `MessageBubble` — renderização polimórfica de uma mensagem por `type` (F1-S15).
 *
 * Faz um `switch` exaustivo sobre a união discriminada `MessageType`
 * (`docs/DATA_MODEL.md` / `LIVECHAT.md §4`) e desenha cada tipo dentro de uma
 * casca comum: inbound à esquerda (`surface-2`), outbound à direita
 * (`surface-3`), com remetente, timestamp e — só em outbound — ícone de status.
 *
 * Os tipos Instagram-específicos (`story_*`, `share`, `comment*`, `referral`)
 * são stubs visuais neste slot, com badge identificando a origem. Mídia
 * (`image`/`video`/`audio`/`voice`/`document`/`sticker`) renderiza `mediaUrl`;
 * quando ele ainda é `null`, mostra um placeholder "carregando mídia…" — a
 * mídia chega de forma assíncrona via `message:media_ready` (F1-S10).
 *
 * O `MessageItem` do frontend não carrega `interactive_payload`, `reaction_emoji`
 * nem metadados de mídia (filename/mime). Renderizamos com o que existe
 * (`content`, `mediaUrl`) e degradamos elegantemente quando falta — sem editar
 * `features/conversations/types.ts` (fora do escopo deste slot).
 */
'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ExternalLink,
  FileText,
  Heart,
  Image as ImageIcon,
  LayoutTemplate,
  ListChecks,
  MapPin,
  MessageSquareReply,
  MousePointerClick,
  Smile,
  Sparkles,
  User,
} from 'lucide-react';
import type { MessageItem } from '../../types';
import { cn } from '@/shared/lib/cn';
import { StatusIcon } from './StatusIcon';
import { assertNever, toMessageType, toViewStatus, type MessageType } from './types';

/** Rótulos legíveis do remetente (pt-BR). */
const SENDER_LABEL: Record<string, string> = {
  contact: 'Contato',
  member: 'Atendente',
  agent: 'Agente IA',
  system: 'Sistema',
};

function senderLabel(senderType: string): string {
  return SENDER_LABEL[senderType] ?? senderType;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export interface MessageBubbleProps {
  message: MessageItem;
  className?: string;
}

/**
 * Renderiza uma mensagem. `system` é centralizada (meta-evento, sem casca de
 * bolha); os demais tipos usam a casca inbound/outbound.
 */
export function MessageBubble({ message, className }: MessageBubbleProps) {
  const type = toMessageType(message.type);

  if (type === 'system') {
    return <SystemNote content={message.content} className={className} />;
  }

  const isOutbound = message.direction === 'outbound';
  const time = formatTime(message.createdAt);

  return (
    <div
      className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start', className)}
      data-direction={message.direction}
      data-type={type}
    >
      <div className="flex max-w-[78%] min-w-0 flex-col gap-1">
        <div
          className={cn(
            'min-w-0 rounded-md px-3 py-2 font-body text-sm',
            // Cauda assimétrica: aponta para o lado do remetente.
            isOutbound
              ? 'rounded-br-sm bg-surface-3 text-text'
              : 'rounded-bl-sm bg-surface-2 text-text',
          )}
        >
          <MessageBody message={message} type={type} />
        </div>

        <BubbleMeta
          senderType={message.senderType}
          time={time}
          createdAt={message.createdAt}
          isOutbound={isOutbound}
          viewStatus={message.viewStatus}
        />
      </div>
    </div>
  );
}

/** Linha de metadados sob a bolha: remetente · horário · status (outbound). */
function BubbleMeta({
  senderType,
  time,
  createdAt,
  isOutbound,
  viewStatus,
}: {
  senderType: string;
  time: string;
  createdAt: string;
  isOutbound: boolean;
  viewStatus: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-1 font-body text-[0.6875rem] text-text-low',
        isOutbound ? 'justify-end' : 'justify-start',
      )}
    >
      <span>{senderLabel(senderType)}</span>
      {time !== '' && (
        <>
          <span aria-hidden>·</span>
          <time dateTime={createdAt}>{time}</time>
        </>
      )}
      {isOutbound && <StatusIcon status={toViewStatus(viewStatus)} className="ml-0.5" />}
    </div>
  );
}

/** Despacho por tipo. Exaustivo via `assertNever`. */
function MessageBody({ message, type }: { message: MessageItem; type: MessageType }) {
  switch (type) {
    case 'text':
      return <TextBody content={message.content} />;
    case 'image':
      return <ImageBody mediaUrl={message.mediaUrl} caption={message.content} />;
    case 'sticker':
      return <StickerBody mediaUrl={message.mediaUrl} />;
    case 'video':
      return <VideoBody mediaUrl={message.mediaUrl} caption={message.content} />;
    case 'audio':
    case 'voice':
      return <AudioBody mediaUrl={message.mediaUrl} isVoice={type === 'voice'} />;
    case 'document':
      return <DocumentBody mediaUrl={message.mediaUrl} caption={message.content} />;
    case 'location':
      return <LocationBody content={message.content} />;
    case 'contact':
      return <ContactBody content={message.content} />;
    case 'interactive':
      return <InteractiveBody content={message.content} />;
    case 'template':
      return <TemplateBody content={message.content} />;
    case 'reaction':
      return <ReactionBody content={message.content} />;
    // — Instagram (stubs visuais neste slot) —
    case 'story_mention':
      return (
        <IgStub icon={ImageIcon} badge="Menção em story" mediaUrl={message.mediaUrl}>
          {message.content}
        </IgStub>
      );
    case 'story_reply':
      return (
        <IgStub icon={MessageSquareReply} badge="Resposta a story" mediaUrl={message.mediaUrl}>
          {message.content}
        </IgStub>
      );
    case 'share':
      return (
        <IgStub icon={ExternalLink} badge="Compartilhamento" mediaUrl={message.mediaUrl}>
          {message.content}
        </IgStub>
      );
    case 'comment':
    case 'comment_reply':
      return (
        <IgStub icon={MessageSquareReply} badge="Comentário">
          {message.content}
        </IgStub>
      );
    case 'ig_postback':
      return <PostbackBody content={message.content} />;
    case 'referral':
      return (
        <IgStub icon={Sparkles} badge="Origem (anúncio / m.me)">
          {message.content}
        </IgStub>
      );
    case 'system':
      // `system` é tratado antes da casca; aqui só satisfaz a exaustividade.
      return <TextBody content={message.content} />;
    default:
      return assertNever(type);
  }
}

/* ── Corpos por tipo ─────────────────────────────────────────────────────── */

/** Placeholder de texto vazio reutilizável. */
function EmptyText({ label }: { label: string }) {
  return <span className="text-text-low italic">{label}</span>;
}

function TextBody({ content }: { content: string | null }) {
  if (content === null || content === '') return <EmptyText label="(sem conteúdo)" />;
  return <p className="break-words whitespace-pre-wrap">{content}</p>;
}

/** Placeholder enquanto a mídia ainda não chegou (async via F1-S10). */
function MediaPending({ label }: { label: string }) {
  return (
    <span
      className="flex items-center gap-2 text-text-mid"
      role="status"
      aria-live="polite"
    >
      <Sparkles className="size-4 shrink-0 motion-safe:animate-pulse" aria-hidden />
      {label}
    </span>
  );
}

function ImageBody({ mediaUrl, caption }: { mediaUrl: string | null; caption: string | null }) {
  if (mediaUrl === null) return <MediaPending label="carregando mídia…" />;
  const alt = caption ?? 'Imagem recebida';
  return (
    <figure className="flex flex-col gap-1">
      {/* mediaUrl é R2 assinado (recurso remoto fora do otimizador do Next) → <img> simples. */}
      <img
        src={mediaUrl}
        alt={alt}
        loading="lazy"
        className="max-h-72 w-full rounded-sm object-cover"
      />
      {caption !== null && caption !== '' && (
        <figcaption className="break-words whitespace-pre-wrap">{caption}</figcaption>
      )}
    </figure>
  );
}

function StickerBody({ mediaUrl }: { mediaUrl: string | null }) {
  if (mediaUrl === null) return <MediaPending label="carregando sticker…" />;
  return (
    // mediaUrl é R2 assinado (recurso remoto fora do otimizador do Next) → <img> simples.
    <img src={mediaUrl} alt="Sticker" loading="lazy" className="size-28 object-contain" />
  );
}

function VideoBody({ mediaUrl, caption }: { mediaUrl: string | null; caption: string | null }) {
  if (mediaUrl === null) return <MediaPending label="carregando vídeo…" />;
  return (
    <figure className="flex flex-col gap-1">
      <video
        src={mediaUrl}
        controls
        preload="metadata"
        className="max-h-72 w-full rounded-sm"
        aria-label={caption ?? 'Vídeo recebido'}
      >
        <track kind="captions" />
      </video>
      {caption !== null && caption !== '' && (
        <figcaption className="break-words whitespace-pre-wrap">{caption}</figcaption>
      )}
    </figure>
  );
}

function AudioBody({ mediaUrl, isVoice }: { mediaUrl: string | null; isVoice: boolean }) {
  const label = isVoice ? 'Mensagem de voz' : 'Áudio';
  if (mediaUrl === null) return <MediaPending label="carregando áudio…" />;
  return (
    <div className="flex min-w-[12rem] flex-col gap-1">
      <span className="text-xs text-text-low">{label}</span>
      <audio src={mediaUrl} controls preload="metadata" className="w-full" aria-label={label} />
    </div>
  );
}

function DocumentBody({ mediaUrl, caption }: { mediaUrl: string | null; caption: string | null }) {
  if (mediaUrl === null) return <MediaPending label="carregando documento…" />;
  const name = caption !== null && caption !== '' ? caption : 'Documento';
  return (
    <a
      href={mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      download
      className={cn(
        'flex items-center gap-2 rounded-sm bg-surface px-2.5 py-2 outline-none',
        'transition-colors hover:bg-surface-inset focus-visible:shadow-glow-md',
      )}
    >
      <FileText className="size-5 shrink-0 text-text-mid" aria-hidden />
      <span className="min-w-0 truncate font-medium text-text underline-offset-2 hover:underline">
        {name}
      </span>
      <span className="sr-only">— baixar documento</span>
    </a>
  );
}

function LocationBody({ content }: { content: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <MapPin className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0">
        <span className="font-medium">Localização</span>
        {content !== null && content !== '' && (
          <p className="break-words whitespace-pre-wrap text-text-mid">{content}</p>
        )}
      </div>
    </div>
  );
}

function ContactBody({ content }: { content: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-surface text-text-mid">
        <User className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <span className="font-medium">Contato compartilhado</span>
        {content !== null && content !== '' && (
          <p className="truncate text-text-mid">{content}</p>
        )}
      </div>
    </div>
  );
}

function InteractiveBody({ content }: { content: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-mid">
        <ListChecks className="size-4" aria-hidden />
        Mensagem interativa
      </span>
      {content !== null && content !== '' ? (
        <p className="break-words whitespace-pre-wrap">{content}</p>
      ) : (
        <EmptyText label="(botões / lista)" />
      )}
    </div>
  );
}

function TemplateBody({ content }: { content: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-mid">
        <LayoutTemplate className="size-4" aria-hidden />
        Template
      </span>
      {content !== null && content !== '' ? (
        <p className="break-words whitespace-pre-wrap">{content}</p>
      ) : (
        <EmptyText label="(template HSM)" />
      )}
    </div>
  );
}

function ReactionBody({ content }: { content: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-mid">
      {content !== null && content !== '' ? (
        <span className="text-base leading-none" aria-hidden>
          {content}
        </span>
      ) : (
        <Heart className="size-4 text-brand" aria-hidden />
      )}
      <span className="text-xs">Reagiu{content !== null && content !== '' ? ` com ${content}` : ''}</span>
    </span>
  );
}

function PostbackBody({ content }: { content: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-pill bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
        <MousePointerClick className="size-3.5" aria-hidden />
        Botão clicado
      </span>
      {content !== null && content !== '' && <span className="break-words">{content}</span>}
    </span>
  );
}

/* ── Stubs Instagram ─────────────────────────────────────────────────────── */

/** Casca comum dos tipos IG renderizados como stub visual neste slot. */
function IgStub({
  icon: Icon,
  badge,
  mediaUrl,
  children,
}: {
  icon: LucideIcon;
  badge: string;
  mediaUrl?: string | null;
  children?: ReactNode;
}) {
  const hasMedia = mediaUrl !== undefined && mediaUrl !== null && mediaUrl !== '';
  return (
    <div className="flex flex-col gap-1.5">
      <span className="inline-flex w-fit items-center gap-1 rounded-pill bg-surface px-2 py-0.5 text-xs font-medium text-text-mid">
        <Icon className="size-3.5" aria-hidden />
        {badge}
      </span>
      {hasMedia && (
        // mediaUrl é R2 assinado (recurso remoto fora do otimizador do Next) → <img> simples.
        <img
          src={mediaUrl}
          alt={badge}
          loading="lazy"
          className="max-h-56 w-full rounded-sm object-cover"
        />
      )}
      {typeof children === 'string' && children !== '' ? (
        <p className="break-words whitespace-pre-wrap">{children}</p>
      ) : null}
    </div>
  );
}

/* ── System note ─────────────────────────────────────────────────────────── */

/** Nota de sistema, centralizada e discreta (LIVECHAT.md §4). */
function SystemNote({ content, className }: { content: string | null; className?: string }) {
  return (
    <div className={cn('flex w-full justify-center', className)} data-type="system">
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1 font-body text-xs text-text-low">
        <Smile className="size-3.5" aria-hidden />
        {content ?? 'Evento do sistema'}
      </span>
    </div>
  );
}
