'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Pencil, Play } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, Modal, useToast, type ButtonSize } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useCancelCampaign, usePauseCampaign, useResumeCampaign } from './queries';
import { isCancellable } from './status';
import type { Campaign } from './types';

export interface CampaignPermissions {
  edit: boolean;
  pause: boolean;
  cancel: boolean;
}

/** Permissões de campanha do papel atual (a guarda real é do servidor). */
export function useCampaignPermissions(): CampaignPermissions {
  const role = useAuthStore((s) => s.auth?.role);
  return {
    edit: role ? can(role, 'campaign.edit') : false,
    pause: role ? can(role, 'campaign.pause') : false,
    cancel: role ? can(role, 'campaign.cancel') : false,
  };
}

/**
 * Ações de escrita de uma campanha: pausar, retomar, editar (só rascunho) e cancelar.
 * Cada uma passa pela guarda de só leitura (F71-S17): focável, `aria-disabled`, com a
 * explicação. Cancelar só PEDE a confirmação (`onCancel`); quem confirma é o diálogo.
 */
export function CampaignActions({
  campaign,
  perms,
  onCancel,
  size = 'sm',
  labelled = false,
}: {
  campaign: Campaign;
  perms: CampaignPermissions;
  onCancel: (c: Campaign) => void;
  size?: ButtonSize;
  /** Rótulo acessível com o nome da campanha (linhas de tabela, onde há vários iguais). */
  labelled?: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const { toast } = useToast();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();

  const canPause = perms.pause && campaign.status === 'running';
  const canResume = perms.pause && campaign.status === 'paused';
  const canEditDraft = perms.edit && campaign.status === 'draft';
  const canCancel = perms.cancel && isCancellable(campaign.status);
  if (!canPause && !canResume && !canEditDraft && !canCancel) return null;

  const named = (verb: string): { 'aria-label'?: string } =>
    labelled ? { 'aria-label': `${verb} ${campaign.name}` } : {};

  return (
    <>
      {canPause ? (
        <ReadOnlyGuard>
          <Button
            variant="secondary"
            size={size}
            loading={pause.isPending}
            leftIcon={<Pause className="size-4" aria-hidden />}
            {...named('Pausar')}
            onClick={() =>
              pause.mutate(campaign.id, {
                onSuccess: () => toast({ title: 'Campanha pausada', description: campaign.name, variant: 'success' }),
                onError: () =>
                  toast({ title: 'Não foi possível pausar', description: 'Tente de novo em instantes.', variant: 'error' }),
              })
            }
          >
            Pausar
          </Button>
        </ReadOnlyGuard>
      ) : null}
      {canResume ? (
        <ReadOnlyGuard>
          <Button
            variant="secondary"
            size={size}
            loading={resume.isPending}
            leftIcon={<Play className="size-4" aria-hidden />}
            {...named('Retomar')}
            onClick={() =>
              resume.mutate(campaign.id, {
                onSuccess: () => toast({ title: 'Campanha retomada', description: campaign.name, variant: 'success' }),
                onError: () =>
                  toast({ title: 'Não foi possível retomar', description: 'Tente de novo em instantes.', variant: 'error' }),
              })
            }
          >
            Retomar
          </Button>
        </ReadOnlyGuard>
      ) : null}
      {canEditDraft ? (
        <ReadOnlyGuard>
          <Button
            variant="secondary"
            size={size}
            leftIcon={<Pencil className="size-4" aria-hidden />}
            {...named('Editar')}
            onClick={() => router.push(`/campaigns/${campaign.id}/edit`)}
          >
            Editar
          </Button>
        </ReadOnlyGuard>
      ) : null}
      {canCancel ? (
        <ReadOnlyGuard>
          <Button variant="ghost" size={size} {...named('Cancelar')} onClick={() => onCancel(campaign)}>
            Cancelar
          </Button>
        </ReadOnlyGuard>
      ) : null}
    </>
  );
}

/**
 * Confirmação de cancelamento (UX §2.9: irreversível → diálogo com o nome e a
 * consequência; o foco abre no botão SEGURO).
 */
export function CancelCampaignDialog({
  campaign,
  onClose,
}: {
  campaign: Campaign | null;
  onClose: () => void;
}): React.JSX.Element {
  const { toast } = useToast();
  const cancel = useCancelCampaign();
  const keepRef = useRef<HTMLButtonElement>(null);

  const confirm = (): void => {
    if (!campaign) return;
    cancel.mutate(campaign.id, {
      onSuccess: () => {
        toast({ title: 'Campanha cancelada', description: campaign.name, variant: 'success' });
        onClose();
      },
      onError: () =>
        toast({ title: 'Não foi possível cancelar', description: 'Tente de novo em instantes.', variant: 'error' }),
    });
  };

  return (
    <Modal
      open={campaign !== null}
      onClose={onClose}
      title="Cancelar campanha?"
      initialFocusRef={keepRef}
      description={
        campaign ? (
          <>
            <span className="font-bold text-text">{campaign.name}</span> para de enviar agora. As
            mensagens já entregues continuam nas conversas. Isto não pode ser desfeito.
          </>
        ) : undefined
      }
      footer={
        <>
          <Button ref={keepRef} variant="ghost" onClick={onClose}>
            Manter campanha
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={confirm}>
            Cancelar campanha
          </Button>
        </>
      }
    />
  );
}
