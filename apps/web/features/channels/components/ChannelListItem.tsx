import { Power, Trash2 } from 'lucide-react';
import { Button } from '@hm/ui';
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

      <div className="flex items-center gap-1">
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
