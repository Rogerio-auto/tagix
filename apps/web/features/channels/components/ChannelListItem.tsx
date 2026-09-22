import Link from 'next/link';
import { FileText, Info, Power, Trash2 } from 'lucide-react';
import { can } from '@hm/shared';
import { Button } from '@hm/ui';
import { useAuthStore } from '@/shared/stores/auth.store';
import { PROVIDER_META } from '../constants';
import type { Channel } from '../types';
import { ChannelStatusBadge } from './ChannelStatusBadge';

export interface ChannelListItemProps {
  channel: Channel;
  /** OWNER/ADMIN — pode ativar/desativar. */
  canDisable: boolean;
  /** OWNER — pode remover. */
  canDelete: boolean;
  busy: boolean;
  onToggleActive: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
}

/** Linha de identificador secundário por provider (telefone / @handle / sessão). */
function subtitle(channel: Channel): string | null {
  if (channel.provider === 'meta_whatsapp') return channel.phoneNumber ?? channel.displayHandle;
  if (channel.provider === 'meta_instagram') {
    return channel.igUsername ? `@${channel.igUsername}` : channel.displayHandle;
  }
  return channel.wahaSessionId ? `Sessão ${channel.wahaSessionId}` : channel.displayHandle;
}

export function ChannelListItem({
  channel,
  canDisable,
  canDelete,
  busy,
  onToggleActive,
  onDelete,
}: ChannelListItemProps) {
  const role = useAuthStore((state) => state.auth?.role);
  const canViewTemplates = role ? can(role, 'message_template.view') : false;
  const meta = PROVIDER_META[channel.provider];
  const Icon = meta.icon;
  const sub = subtitle(channel);

  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-inset text-text-mid">
        <Icon className="size-5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-head text-sm font-semibold text-text">{channel.name}</p>
          {channel.isDefault && (
            <span className="rounded-pill bg-brand/15 px-2 py-0.5 font-head text-xs font-medium text-brand">
              Padrão
            </span>
          )}
        </div>
        <p className="truncate font-body text-xs text-text-low">
          {meta.label}
          {sub ? ` · ${sub}` : ''}
        </p>
      </div>

      <ChannelStatusBadge channel={channel} />

      <div className="flex flex-wrap items-center justify-end gap-1">
        {canViewTemplates && channel.provider === 'meta_whatsapp' ? (
          <Link
            href={`/settings/channels/${encodeURIComponent(channel.id)}/message-templates`}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-transparent px-3 font-head text-sm font-semibold text-text outline-none hover:bg-surface-2 focus-visible:shadow-glow-md"
          >
            <FileText className="size-4" aria-hidden />
            Modelos de mensagem
          </Link>
        ) : canViewTemplates ? (
          <span
            className="inline-flex max-w-48 items-center gap-1.5 text-right text-xs text-text-low"
            title={
              channel.provider === 'meta_instagram'
                ? 'O Instagram usa mensagens diretas e não oferece modelos aprovados do WhatsApp.'
                : 'O WhatsApp via WAHA segue regras próprias e não usa modelos aprovados pela Meta.'
            }
          >
            <Info className="size-4 shrink-0" aria-hidden />
            {channel.provider === 'meta_instagram'
              ? 'Instagram usa mensagem direta'
              : 'WAHA não usa modelos da Meta'}
          </span>
        ) : null}
        {canDisable && (
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            leftIcon={<Power className="size-4" aria-hidden />}
            onClick={() => onToggleActive(channel)}
          >
            {channel.isActive ? 'Desativar' : 'Ativar'}
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remover canal ${channel.name}`}
            onClick={() => onDelete(channel)}
          >
            <Trash2 className="size-4 text-danger" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}
