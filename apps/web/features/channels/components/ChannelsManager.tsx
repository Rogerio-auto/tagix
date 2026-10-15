'use client';

import { useState } from 'react';
import { Plus, Radio } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, Skeleton, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { EmptyState, ErrorState } from '@/shared/components/feedback';
import { HelpPanel } from '@/shared/components/help';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { ApiError } from '@/shared/lib/api-client';
import { formatNumber } from '@/shared/lib/locale';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ChannelsHelp } from '../help';
import { useChannels, useDeleteChannel, useSetChannelActive } from '../queries';
import type { Channel } from '../types';
import { ChannelListItem } from './ChannelListItem';
import { ConfirmDialog } from './ConfirmDialog';
import { ConnectWizard } from './ConnectWizard';

/**
 * Canais (F10-S03) no DS 3.0 (F72-S07): cabeçalho com a contagem em mono, lista de canais
 * numa superfície com hairline (status vivo por canal), vazio com o CTA único e
 * confirmação proporcional para remover (UX §2.9).
 *
 * A lista segue como lista (não `DataTable`): são poucos canais, cada um com identidade e
 * ações próprias, e o Page Object da suíte e2e (`ChannelsPage.channelRow`) localiza o canal
 * pelo `listitem`.
 *
 * Só leitura (F71-S17): "Conectar canal", ativar/desativar e remover ficam `aria-disabled`
 * com a explicação.
 *
 * UX: §2.5 `?` (HelpPanel); §2.6 vazio com CTA; §2.7 esqueleto e botão em loading;
 * §2.9 remover pede confirmação; §2.11 erro em 3 partes.
 */
export function ChannelsManager() {
  const role = useAuthStore((s) => s.auth?.role);
  const canConnect = role ? can(role, 'channel.connect') : false;
  const canDisable = role ? can(role, 'channel.disable') : false;
  const canDelete = role ? can(role, 'channel.delete') : false;

  const { toast } = useToast();
  const channels = useChannels();
  const setActive = useSetChannelActive();
  const remove = useDeleteChannel();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Channel | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const notifyError = (err: unknown, fallbackTitle: string) => {
    const message = err instanceof ApiError ? err.message : 'Tente novamente.';
    const ref = err instanceof ApiError ? err.ref : undefined;
    toast({
      variant: 'error',
      title: fallbackTitle,
      description: ref ? `${message} (ref ${ref})` : message,
    });
  };

  const toggleActive = async (channel: Channel) => {
    setPendingId(channel.id);
    try {
      await setActive.mutateAsync({ id: channel.id, isActive: !channel.isActive });
      toast({
        variant: 'success',
        title: channel.isActive ? 'Canal desativado' : 'Canal ativado',
        description: channel.name,
      });
    } catch (err) {
      notifyError(err, 'Falha ao atualizar o canal');
    } finally {
      setPendingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await remove.mutateAsync({ id: toDelete.id });
      toast({ variant: 'success', title: 'Canal removido', description: toDelete.name });
      setToDelete(null);
    } catch (err) {
      notifyError(err, 'Falha ao remover o canal');
    }
  };

  const connectButton = canConnect ? (
    <ReadOnlyGuard>
      <Button
        variant="primary"
        leftIcon={<Plus className="size-4" aria-hidden />}
        onClick={() => setWizardOpen(true)}
      >
        Conectar canal
      </Button>
    </ReadOnlyGuard>
  ) : null;

  const list = channels.data?.channels ?? [];
  const connected = list.filter((c) => c.isActive).length;
  const description = channels.data ? (
    <span>
      <span className="font-mono tabular-nums text-text-mid">{formatNumber(list.length)}</span>{' '}
      {list.length === 1 ? 'canal' : 'canais'} ·{' '}
      <span className="font-mono tabular-nums text-text-mid">{formatNumber(connected)}</span>{' '}
      {connected === 1 ? 'ativo' : 'ativos'}
    </span>
  ) : (
    'De onde chegam as suas conversas: WhatsApp, Instagram e e-mail.'
  );

  return (
    <div>
      <PageHeader
        title="Canais"
        description={description}
        actions={connectButton}
        helpSlot={
          <HelpPanel title="Canais">
            <ChannelsHelp />
          </HelpPanel>
        }
      />

      {channels.isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Carregando canais"
          className="divide-y divide-border rounded-lg border border-border bg-surface"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <Skeleton className="size-10 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <Skeleton className="h-5 w-24 rounded-pill" />
            </div>
          ))}
        </div>
      ) : channels.isError ? (
        <ErrorState
          title="Não foi possível carregar os canais"
          reason="A conexão com a API falhou ou expirou."
          whatToDo="Verifique sua conexão e tente novamente."
          action={
            <Button variant="secondary" loading={channels.isFetching} onClick={() => void channels.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="Nenhum canal conectado"
          description="Conecte o WhatsApp ou o Instagram para começar a receber e responder conversas."
          action={connectButton ?? undefined}
        />
      ) : (
        <ul aria-label="Canais conectados" className="divide-y divide-border rounded-lg border border-border bg-surface">
            {list.map((channel) => (
              <ChannelListItem
                key={channel.id}
                channel={channel}
                canDisable={canDisable}
                canDelete={canDelete}
                busy={pendingId === channel.id}
                onToggleActive={(c) => void toggleActive(c)}
                onDelete={setToDelete}
              />
            ))}
        </ul>
      )}

      <ConnectWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <ConfirmDialog
        open={toDelete !== null}
        title="Remover canal"
        description={
          toDelete
            ? `Remover "${toDelete.name}" é permanente: o canal e suas credenciais serão apagados. As conversas existentes permanecem no histórico.`
            : ''
        }
        confirmLabel="Remover canal"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
