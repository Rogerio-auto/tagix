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

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ExternalLink,
  FileText,
  FileWarning,
  Heart,
  Image as ImageIcon,
  ImageOff,
  LayoutTemplate,
  ListChecks,
  MapPin,
  MessageSquareReply,
  MousePointerClick,
  RefreshCw,
  Smile,
  SmilePlus,
  Sparkles,
  User,
} from 'lucide-react';
import type { MessageItem } from '../../types';
import { cn } from '@/shared/lib/cn';
import { useReactions, type UseReactionsResult } from '../../hooks/useReactions';
import { ReactionPicker } from '../ReactionPicker';
import { StatusIcon } from './StatusIcon';
import { assertNever, toMessageType, toViewStatus, type MessageType } from './types';
import { useMediaResource, type MediaResource } from './useMediaResource';

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
 * Lê os campos crus de uma linha `type:'reaction'` que a API devolve (select *)
 * mas o `MessageItem` do frontend não declara — sem editar `types.ts` (fora do
 * escopo do slot). `null` quando a reação não referencia um alvo interno (não há
 * onde ancorar o chip → cai no render padrão de bolha, sem perder o dado).
 */
function readReactionRow(message: MessageItem): { targetId: string; emoji: string } | null {
  const raw = message as unknown as { replyToMessageId?: unknown; reactionEmoji?: unknown };
  const targetId = typeof raw.replyToMessageId === 'string' ? raw.replyToMessageId : null;
  if (targetId === null || targetId === '') return null;
  const emoji =
    typeof raw.reactionEmoji === 'string' ? raw.reactionEmoji : (message.content ?? '');
  return { targetId, emoji };
}

/**
 * Renderiza uma mensagem. `system` é centralizada (meta-evento, sem casca de
 * bolha); os demais tipos usam a casca inbound/outbound.
 *
 * Reações (F45-S06): uma linha `type:'reaction'` NÃO vira bolha solta — dobra
 * num chip ancorado à mensagem-alvo (via `useReactions`); a bolha "reagível"
 * ganha o gatilho de hover/long-press + o chip da própria reação.
 */
export function MessageBubble({ message, className }: MessageBubbleProps) {
  const type = toMessageType(message.type);
  const reactions = useReactions(message.conversationId);

  // Dobra a reação persistida no chip do alvo (idempotente; ver useReactions).
  const folded = type === 'reaction' ? readReactionRow(message) : null;
  const foldTarget = folded?.targetId;
  const foldEmoji = folded?.emoji;
  const { foldPersisted } = reactions;
  useEffect(() => {
    if (foldTarget !== undefined && foldEmoji !== undefined) {
      foldPersisted(foldTarget, foldEmoji);
    }
  }, [foldTarget, foldEmoji, foldPersisted]);

  if (type === 'system') {
    return <SystemNote content={message.content} className={className} />;
  }

  // Reação dobrada no chip do alvo → sem bolha própria.
  if (folded) return null;

  return <ReactableBubble message={message} type={type} className={className} reactions={reactions} />;
}

/** Janela em ms para o long-press (toque) abrir o picker. */
const LONG_PRESS_MS = 500;

/**
 * Bolha "reagível": casca inbound/outbound + gatilho de reação (hover no desktop,
 * long-press no mobile), picker ancorado e chip da reação própria (otimista).
 */
function ReactableBubble({
  message,
  type,
  className,
  reactions,
}: {
  message: MessageItem;
  type: MessageType;
  className?: string;
  reactions: UseReactionsResult;
}) {
  const isOutbound = message.direction === 'outbound';
  const time = formatTime(message.createdAt);
  const [pickerOpen, setPickerOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);

  // Só reage a mensagens com `external_id` resolvido (o provider precisa conhecer
  // o alvo — a rota resolve external_id sob RLS). Evita 404 garantido em bolhas
  // otimistas / pendentes ainda sem id externo.
  const canReact =
    type !== 'reaction' &&
    typeof message.externalId === 'string' &&
    message.externalId.length > 0;

  const myReaction = reactions.reactionFor(message.id);
  const align: 'start' | 'end' = isOutbound ? 'end' : 'start';

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }
  function startLongPress() {
    if (!canReact) return;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => setPickerOpen(true), LONG_PRESS_MS);
  }
  useEffect(() => clearLongPress, []);

  function applyReaction(emoji: string) {
    reactions.sendReaction(message.id, emoji);
  }

  return (
    <div
      className={cn(
        'group/bubble flex w-full',
        isOutbound ? 'justify-end' : 'justify-start',
        className,
      )}
      data-direction={message.direction}
      data-type={type}
    >
      <div className="relative flex max-w-[78%] min-w-0 flex-col gap-1">
        <div
          className={cn(
            'min-w-0 rounded-md px-3 py-2 font-body text-sm',
            // Cauda assimétrica: aponta para o lado do remetente.
            isOutbound
              ? 'rounded-br-sm bg-surface-3 text-text'
              : 'rounded-bl-sm bg-surface-2 text-text',
          )}
          onPointerDown={startLongPress}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onPointerCancel={clearLongPress}
          onContextMenu={(e) => {
            if (canReact) e.preventDefault();
          }}
        >
          <MessageBody message={message} type={type} />
        </div>

        {/* Chip da reação própria — clique remove (toggle off). */}
        {myReaction !== '' && (
          <div className={cn('flex px-1', isOutbound ? 'justify-end' : 'justify-start')}>
            <ReactionChip
              emoji={myReaction}
              disabled={reactions.isPending}
              onRemove={() => applyReaction(myReaction)}
            />
          </div>
        )}

        <BubbleMeta
          senderType={message.senderType}
          time={time}
          createdAt={message.createdAt}
          isOutbound={isOutbound}
          viewStatus={message.viewStatus}
        />

        {/* Gatilho (desktop): revelado no hover da bolha. Mobile usa long-press. */}
        {canReact && (
          <button
            type="button"
            aria-label="Reagir à mensagem"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
            className={cn(
              'absolute top-1 grid size-7 place-items-center rounded-pill border border-border bg-surface-3 text-text-mid outline-none',
              'opacity-0 motion-safe:transition-opacity hover:text-text',
              'group-hover/bubble:opacity-100 focus-visible:opacity-100 focus-visible:shadow-glow-md',
              isOutbound ? '-left-9' : '-right-9',
            )}
          >
            <SmilePlus className="size-4" aria-hidden />
          </button>
        )}

        {pickerOpen && (
          <ReactionPicker
            current={myReaction}
            onSelect={applyReaction}
            onClose={() => setPickerOpen(false)}
            align={align}
          />
        )}
      </div>
    </div>
  );
}

/** Chip da reação aplicada pela pessoa. Clique remove (re-envia o mesmo emoji). */
function ReactionChip({
  emoji,
  disabled,
  onRemove,
}: {
  emoji: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled}
      aria-label={`Remover reação ${emoji}`}
      title="Remover reação"
      className={cn(
        '-mt-1.5 inline-flex items-center gap-1 rounded-pill border border-border bg-surface-2 px-2 py-0.5 text-sm leading-none outline-none',
        'motion-safe:transition-colors hover:border-border-2 focus-visible:shadow-glow-md',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <span aria-hidden>{emoji}</span>
    </button>
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
      return <ImageBody message={message} />;
    case 'sticker':
      return <StickerBody message={message} />;
    case 'video':
      return <VideoBody message={message} />;
    case 'audio':
    case 'voice':
      return <AudioBody message={message} isVoice={type === 'voice'} />;
    case 'document':
      return <DocumentBody message={message} />;
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

/** Placeholder enquanto a mídia ainda não chegou (async via F1-S10) / reidrata. */
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

/**
 * Estado de erro acionável da mídia (UX §2: nunca um beco sem saída). Mensagem
 * amigável + "Tentar novamente" (reidrata a signed URL via F52-S06). `icon`
 * varia por tipo (imagem/áudio/documento) para o contexto ficar claro.
 */
function MediaError({
  icon: Icon,
  label,
  onRetry,
}: {
  icon: LucideIcon;
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5" role="alert">
      <span className="flex items-center gap-2 text-sm text-danger">
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium text-text-mid outline-none',
          'transition-colors hover:bg-surface hover:text-text focus-visible:shadow-glow-md',
        )}
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Tentar novamente
      </button>
    </div>
  );
}

/**
 * Casca comum dos três estados de mídia (pending → ready → error). Escolhe o que
 * renderizar a partir do `resource`; o `render` recebe a URL pronta e o handler
 * de `onError` (reidratação) para plugar no elemento de mídia.
 */
function MediaSurface({
  resource,
  pendingLabel,
  errorIcon,
  errorLabel,
  render,
}: {
  resource: MediaResource;
  pendingLabel: string;
  errorIcon: LucideIcon;
  errorLabel: string;
  render: (url: string, onError: () => void) => ReactNode;
}) {
  if (resource.state === 'error') {
    return <MediaError icon={errorIcon} label={errorLabel} onRetry={resource.retry} />;
  }
  if (resource.url === null) {
    return <MediaPending label={pendingLabel} />;
  }
  return <>{render(resource.url, resource.onMediaError)}</>;
}

function ImageBody({ message }: { message: MessageItem }) {
  const resource = useMediaResource({
    conversationId: message.conversationId,
    messageId: message.id,
    initialUrl: message.mediaUrl,
    failed: message.mediaFailed,
  });
  const caption = message.content;
  const alt = caption ?? 'Imagem recebida';
  return (
    <MediaSurface
      resource={resource}
      pendingLabel="carregando mídia…"
      errorIcon={ImageOff}
      errorLabel="Não foi possível carregar a imagem."
      render={(url, onError) => (
        <figure className="flex flex-col gap-1">
          {/* mediaUrl é R2 assinado (recurso remoto fora do otimizador do Next) → <img> simples. */}
          <img
            src={url}
            alt={alt}
            loading="lazy"
            onError={onError}
            className="max-h-72 w-full rounded-sm object-cover"
          />
          {caption !== null && caption !== '' && (
            <figcaption className="break-words whitespace-pre-wrap">{caption}</figcaption>
          )}
        </figure>
      )}
    />
  );
}

function StickerBody({ message }: { message: MessageItem }) {
  const resource = useMediaResource({
    conversationId: message.conversationId,
    messageId: message.id,
    initialUrl: message.mediaUrl,
    failed: message.mediaFailed,
  });
  return (
    <MediaSurface
      resource={resource}
      pendingLabel="carregando sticker…"
      errorIcon={ImageOff}
      errorLabel="Não foi possível carregar o sticker."
      render={(url, onError) => (
        // mediaUrl é R2 assinado (recurso remoto fora do otimizador do Next) → <img> simples.
        <img
          src={url}
          alt="Sticker"
          loading="lazy"
          onError={onError}
          className="size-28 object-contain"
        />
      )}
    />
  );
}

function VideoBody({ message }: { message: MessageItem }) {
  const resource = useMediaResource({
    conversationId: message.conversationId,
    messageId: message.id,
    initialUrl: message.mediaUrl,
    failed: message.mediaFailed,
  });
  const caption = message.content;
  return (
    <MediaSurface
      resource={resource}
      pendingLabel="carregando vídeo…"
      errorIcon={ImageOff}
      errorLabel="Não foi possível carregar o vídeo."
      render={(url, onError) => (
        <figure className="flex flex-col gap-1">
          <video
            src={url}
            controls
            preload="metadata"
            onError={onError}
            className="max-h-72 w-full rounded-sm"
            aria-label={caption ?? 'Vídeo recebido'}
          >
            <track kind="captions" />
          </video>
          {caption !== null && caption !== '' && (
            <figcaption className="break-words whitespace-pre-wrap">{caption}</figcaption>
          )}
        </figure>
      )}
    />
  );
}

function AudioBody({ message, isVoice }: { message: MessageItem; isVoice: boolean }) {
  const label = isVoice ? 'Mensagem de voz' : 'Áudio';
  const resource = useMediaResource({
    conversationId: message.conversationId,
    messageId: message.id,
    initialUrl: message.mediaUrl,
    failed: message.mediaFailed,
  });
  return (
    <div className="flex min-w-[12rem] flex-col gap-1">
      <span className="text-xs text-text-low">{label}</span>
      <MediaSurface
        resource={resource}
        pendingLabel="carregando áudio…"
        errorIcon={FileWarning}
        errorLabel={`Não foi possível carregar ${isVoice ? 'a mensagem de voz' : 'o áudio'}.`}
        render={(url, onError) => (
          <audio
            src={url}
            controls
            preload="metadata"
            onError={onError}
            className="w-full"
            aria-label={label}
          />
        )}
      />
    </div>
  );
}

function DocumentBody({ message }: { message: MessageItem }) {
  const resource = useMediaResource({
    conversationId: message.conversationId,
    messageId: message.id,
    initialUrl: message.mediaUrl,
    failed: message.mediaFailed,
  });
  const caption = message.content;
  const name = caption !== null && caption !== '' ? caption : 'Documento';
  // Um <a> não dispara `onError` de carregamento (não é elemento de mídia), então
  // aqui só distinguimos pending vs error definitivo (failed) — sem auto-refresh.
  if (resource.state === 'error') {
    return (
      <MediaError
        icon={FileWarning}
        label="Não foi possível carregar o documento."
        onRetry={resource.retry}
      />
    );
  }
  if (resource.url === null) {
    return <MediaPending label="carregando documento…" />;
  }
  return (
    <a
      href={resource.url}
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
