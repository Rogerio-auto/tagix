import Link from 'next/link';
import { FileText, Info, Power, Trash2 } from 'lucide-react';
import { can } from '@hm/shared';
import { Badge, Button } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
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

/**
 * Um canal na lista (DS 3.0, F72-S07): identidade (ícone do provedor, nome, selo "Padrão"),
 * o identificador em mono (telefone/@/sessão), o status vivo e as ações. Desktop em uma
 * linha; celular empilha o status ao lado do nome e as ações embaixo.
 *
 * Só leitura (F71-S17): ativar/desativar e remover ficam `aria-disabled` com a explicação;
 * "Modelos de mensagem" é consulta e segue livre.
 */
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
    // Grade: no celular [identidade | status] e as ações na linha de baixo; no desktop uma
    // linha só [identidade | status | ações]. Um único selo de status no DOM.
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-4 transition-colors duration-(--dur-fast) first:rounded-t-lg last:rounded-b-lg hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-text-mid"
        >
          <Icon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 break-words font-head text-base font-semibold text-text md:truncate">{channel.name}</p>
            {channel.isDefault && (
              <Badge tone="brand" size="sm">
                Padrão
              </Badge>
            )}
          </div>
          <p className="break-words font-body text-sm text-text-low md:truncate">
            {meta.label}
            {sub ? (
              <>
                {' · '}
                <span className="font-mono tabular-nums text-text-mid">{sub}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <ChannelStatusBadge channel={channel} />

      <div className="col-span-2 flex flex-wrap items-center gap-1 max-md:-ml-3 md:col-span-1 md:justify-end">
        {canViewTemplates && channel.provider === 'meta_whatsapp' ? (
          <Link
            href={`/settings/channels/${encodeURIComponent(channel.id)}/message-templates`}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-sm px-3 font-body text-sm font-bold text-text-mid outline-none transition-colors duration-(--dur-base) hover:bg-surface-2 hover:text-text focus-visible:focus-ring max-md:h-11"
          >
            <FileText className="size-4" aria-hidden />
            Modelos de mensagem
          </Link>
        ) : canViewTemplates ? (
          <span
            className="inline-flex max-w-56 items-center gap-1.5 px-3 font-body text-sm text-text-low md:text-right"
            title={
              channel.provider === 'meta_instagram'
                ? 'O Instagram usa mensagens diretas e não oferece modelos aprovados do WhatsApp.'
                : 'O WhatsApp via WAHA segue regras próprias e não usa modelos aprovados pela Meta.'
            }
          >
            <Info className="size-4 shrink-0" aria-hidden />
            {channel.provider === 'meta_instagram' ? 'Instagram usa mensagem direta' : 'WAHA não usa modelos da Meta'}
          </span>
        ) : null}
        {canDisable && (
          <ReadOnlyGuard>
            <Button
              variant="ghost"
              size="sm"
              className="max-md:h-11"
              loading={busy}
              leftIcon={<Power className="size-4" aria-hidden />}
              aria-label={`${channel.isActive ? 'Desativar' : 'Ativar'} o canal ${channel.name}`}
              onClick={() => onToggleActive(channel)}
            >
              {channel.isActive ? 'Desativar' : 'Ativar'}
            </Button>
          </ReadOnlyGuard>
        )}
        {canDelete && (
          <ReadOnlyGuard>
            <Button
              variant="ghost"
              size="sm"
              className="max-md:size-11 max-md:px-0"
              aria-label={`Remover canal ${channel.name}`}
              onClick={() => onDelete(channel)}
            >
              <Trash2 className="size-4 text-danger" aria-hidden />
            </Button>
          </ReadOnlyGuard>
        )}
      </div>
    </li>
  );
}
