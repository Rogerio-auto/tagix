'use client';

import { useState } from 'react';
import { Plus, Radio } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, Card, useToast } from '@hm/ui';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { HelpPanel } from '@/shared/components/help';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ChannelsHelp } from '../help';
import { useChannels, useDeleteChannel, useSetChannelActive } from '../queries';
import type { Channel } from '../types';
import { ChannelListItem } from './ChannelListItem';
import { ConfirmDialog } from './ConfirmDialog';
import { ConnectWizard } from './ConnectWizard';

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
    <Button
      variant="primary"
      leftIcon={<Plus className="size-4" aria-hidden />}
      onClick={() => setWizardOpen(true)}
    >
      Conectar canal
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Canais"
        actions={connectButton}
        helpSlot={
          <HelpPanel title="Canais">
            <ChannelsHelp />
          </HelpPanel>
        }
      />

      {channels.isLoading ? (
        <SkeletonList rows={4} />
      ) : channels.isError ? (
        <ErrorState
          title="Não foi possível carregar os canais"
          reason="A conexão com a API falhou ou expirou."
          whatToDo="Verifique sua conexão e tente novamente."
          action={
            <Button variant="secondary" onClick={() => void channels.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : !channels.data || channels.data.channels.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="Nenhum canal conectado"
          description="Conecte o WhatsApp ou o Instagram para começar a receber e responder conversas."
          action={connectButton ?? undefined}
        />
      ) : (
        <Card elevation={1}>
          <ul className="divide-y divide-border-2">
            {channels.data.channels.map((channel) => (
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
        </Card>
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
