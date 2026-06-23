'use client';

/**
 * `MessagePreview` — preview da última mensagem na ChatList, no padrão WhatsApp.
 *
 * O backend grava `conversations.last_message_preview` como o texto da mensagem
 * quando há texto/legenda, ou como um token `[<tipo>]` quando é mídia sem legenda
 * (ver `previewOf` em apps/workers/src/inbound/db-ports.ts e coexistence/db-ports.ts).
 * Em vez de mostrar o token cru (`[voice]`, `[image]`…), aqui ele vira um ícone +
 * rótulo legível (🎤 "Mensagem de voz", 📷 "Foto"…) — como na lista de conversas
 * do WhatsApp. Texto comum é renderizado como está (truncado pelo pai).
 *
 * DS v2: zero hex hardcoded; ícones lucide herdam a cor do texto via `currentColor`.
 */

import type { LucideIcon } from 'lucide-react';
import {
  FileText,
  Heart,
  Image as ImageIcon,
  LayoutTemplate,
  ListChecks,
  MapPin,
  MessageSquareReply,
  Mic,
  MousePointerClick,
  Music,
  Paperclip,
  Share2,
  Sparkles,
  Sticker,
  User,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';

interface MediaPreviewMeta {
  readonly icon: LucideIcon;
  readonly label: string;
}

/**
 * Mapa token→(ícone, rótulo). As chaves correspondem aos `messages.type`
 * (`messages_type_chk`) empacotados como `[tipo]` no preview, mais os apelidos
 * legados (`comentario`) e variações de canal.
 */
const MEDIA_PREVIEW: Record<string, MediaPreviewMeta> = {
  image: { icon: ImageIcon, label: 'Foto' },
  video: { icon: ImageIcon, label: 'Vídeo' },
  audio: { icon: Music, label: 'Áudio' },
  ptt: { icon: Mic, label: 'Mensagem de voz' },
  voice: { icon: Mic, label: 'Mensagem de voz' },
  document: { icon: FileText, label: 'Documento' },
  sticker: { icon: Sticker, label: 'Figurinha' },
  location: { icon: MapPin, label: 'Localização' },
  contact: { icon: User, label: 'Contato' },
  contacts: { icon: User, label: 'Contato' },
  interactive: { icon: ListChecks, label: 'Mensagem interativa' },
  template: { icon: LayoutTemplate, label: 'Template' },
  reaction: { icon: Heart, label: 'Reação' },
  story_mention: { icon: ImageIcon, label: 'Menção em story' },
  story_reply: { icon: MessageSquareReply, label: 'Resposta a story' },
  share: { icon: Share2, label: 'Compartilhamento' },
  comment: { icon: MessageSquareReply, label: 'Comentário' },
  comentario: { icon: MessageSquareReply, label: 'Comentário' },
  comment_reply: { icon: MessageSquareReply, label: 'Comentário' },
  ig_postback: { icon: MousePointerClick, label: 'Botão clicado' },
  referral: { icon: Sparkles, label: 'Origem' },
};

/** Fallback para qualquer token `[xxx]` não mapeado (mídia desconhecida). */
const UNKNOWN_MEDIA: MediaPreviewMeta = { icon: Paperclip, label: 'Anexo' };

const TOKEN_RE = /^\[([a-z_]+)\]$/;

/**
 * Resolve o preview num token de mídia conhecido, ou `null` se for texto comum.
 * `system` é tratado como texto (a nota de sistema já é legível).
 */
function resolveMedia(preview: string): MediaPreviewMeta | null {
  const match = TOKEN_RE.exec(preview);
  if (!match) return null;
  const key = match[1]!;
  if (key === 'system' || key === 'text') return null;
  return MEDIA_PREVIEW[key] ?? UNKNOWN_MEDIA;
}

export interface MessagePreviewProps {
  preview: string | null;
  /** Conversa com não-lidas pinta o texto mais forte (paridade com o item). */
  unread: boolean;
}

export function MessagePreview({ preview, unread }: MessagePreviewProps) {
  const colorClass = unread ? 'text-text-mid' : 'text-text-low';

  if (preview === null || preview === '') {
    return <p className={cn('truncate font-body text-sm', colorClass)}>Sem mensagens</p>;
  }

  const media = resolveMedia(preview);

  if (media === null) {
    return <p className={cn('truncate font-body text-sm', colorClass)}>{preview}</p>;
  }

  const Icon = media.icon;
  return (
    <p className={cn('flex min-w-0 items-center gap-1 font-body text-sm', colorClass)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{media.label}</span>
    </p>
  );
}
