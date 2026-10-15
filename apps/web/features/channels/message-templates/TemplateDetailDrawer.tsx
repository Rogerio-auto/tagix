'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Copy, CopyPlus } from 'lucide-react';
import { Button, Drawer, IconButton, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { categoryLabel, displayTemplateName, formatDateTime, templateStatus } from './format';
import { TemplatePreview } from './TemplatePreview';
import { TemplateStatusBadge } from './TemplateStatusBadge';
import type { MessageTemplate } from './types';

export function TemplateDetailDrawer({
  channelId,
  channelName,
  template,
  canUseInCampaign,
  canManage,
  onClose,
  onCreateVersion,
}: {
  channelId: string;
  channelName: string;
  template: MessageTemplate | null;
  canUseInCampaign: boolean;
  canManage: boolean;
  onClose: () => void;
  onCreateVersion: (template: MessageTemplate) => void;
}) {
  const status = template ? templateStatus(template) : null;
  const { toast } = useToast();
  const router = useRouter();

  // O nome técnico é o que a API e as integrações usam para enviar o modelo: copiável.
  const copyName = async (name: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(name);
      toast({ variant: 'success', title: 'Nome do modelo copiado', description: name });
    } catch {
      toast({ variant: 'error', title: 'Não foi possível copiar', description: 'Selecione o nome e copie manualmente.' });
    }
  };
  return (
    <Drawer
      open={template !== null}
      onClose={onClose}
      title={template ? displayTemplateName(template.name) : 'Detalhes do modelo'}
      description={`${channelName} · modelo de mensagem do WhatsApp`}
      className="sm:max-w-xl"
      footer={
        template && status ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            {(template.status === 'REJECTED' || !template.isAvailable) && canManage ? (
              <ReadOnlyGuard>
                <Button variant="secondary" leftIcon={<CopyPlus className="size-4" aria-hidden />} onClick={() => onCreateVersion(template)}>
                  Criar versão corrigida
                </Button>
              </ReadOnlyGuard>
            ) : null}
            {status.canUse && canUseInCampaign ? (
              // Primário do DS (o único neon da tela): abre a campanha nova já com o modelo.
              <Button
                variant="primary"
                rightIcon={<ArrowRight className="size-4" aria-hidden />}
                onClick={() =>
                  router.push(
                    `/campaigns/new?channelId=${encodeURIComponent(channelId)}&messageTemplateId=${encodeURIComponent(template.id)}`,
                  )
                }
              >
                Usar em campanha
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {template && status ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <TemplateStatusBadge template={template} />
            <span className="text-sm text-text-mid">{categoryLabel(template.category)} · {template.language}</span>
          </div>

          <div className="rounded-md border border-border bg-surface-2 px-4 py-3">
            <p className="font-body text-sm font-bold text-text">O que fazer agora</p>
            <p className="mt-1 text-sm text-text-mid">{status.guidance}</p>
            {template.rejectionReason ? (
              <div className="mt-3 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2">
                <p className="text-sm font-bold text-danger">Motivo informado pela Meta</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-text-mid">{template.rejectionReason}</p>
              </div>
            ) : null}
          </div>

          <TemplatePreview template={template} />

          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-low">Nome cadastrado</dt>
              <dd className="mt-1 flex items-start gap-1">
                <span className="min-w-0 break-all font-mono text-text">{template.name}</span>
                <IconButton
                  size="sm"
                  aria-label={`Copiar o nome ${template.name}`}
                  icon={<Copy />}
                  className="-mt-1 shrink-0"
                  onClick={() => void copyName(template.name)}
                />
              </dd>
            </div>
            <div><dt className="text-text-low">Idioma</dt><dd className="mt-1 font-mono text-text">{template.language}</dd></div>
            <div><dt className="text-text-low">Última sincronização</dt><dd className="mt-1 font-mono tabular-nums text-text">{formatDateTime(template.lastSyncedAt)}</dd></div>
            <div><dt className="text-text-low">Status técnico</dt><dd className="mt-1 font-mono text-text">{template.status}</dd></div>
          </dl>

          {status.canUse && !canUseInCampaign ? (
            <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-mid">
              Você pode consultar este modelo, mas precisa da permissão de editar campanhas para usá-lo em um rascunho.
            </p>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
