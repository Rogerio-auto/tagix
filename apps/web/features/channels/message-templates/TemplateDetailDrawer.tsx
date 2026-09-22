'use client';

import Link from 'next/link';
import { ArrowRight, CopyPlus } from 'lucide-react';
import { Button, Drawer } from '@hm/ui';
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
              <Button variant="secondary" leftIcon={<CopyPlus className="size-4" aria-hidden />} onClick={() => onCreateVersion(template)}>
                Criar versão corrigida
              </Button>
            ) : null}
            {status.canUse && canUseInCampaign ? (
              <Link
                href={`/campaigns/new?channelId=${encodeURIComponent(channelId)}&messageTemplateId=${encodeURIComponent(template.id)}`}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 font-head text-sm font-semibold text-text-on-brand outline-none hover:bg-brand-strong focus-visible:shadow-glow-md"
              >
                Usar em campanha <ArrowRight className="size-4" aria-hidden />
              </Link>
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

          <div className="rounded-md border border-border-2 bg-surface-2 px-4 py-3">
            <p className="font-head text-sm font-semibold text-text">O que fazer agora</p>
            <p className="mt-1 text-sm text-text-mid">{status.guidance}</p>
            {template.rejectionReason ? (
              <div className="mt-3 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2">
                <p className="text-xs font-semibold text-danger">Motivo informado pela Meta</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-text-mid">{template.rejectionReason}</p>
              </div>
            ) : null}
          </div>

          <TemplatePreview template={template} />

          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-text-low">Nome cadastrado</dt><dd className="mt-1 break-all font-price text-text">{template.name}</dd></div>
            <div><dt className="text-text-low">Idioma</dt><dd className="mt-1 text-text">{template.language}</dd></div>
            <div><dt className="text-text-low">Última sincronização</dt><dd className="mt-1 text-text">{formatDateTime(template.lastSyncedAt)}</dd></div>
            <div><dt className="text-text-low">Status técnico</dt><dd className="mt-1 font-price text-text">{template.status}</dd></div>
          </dl>

          {status.canUse && !canUseInCampaign ? (
            <p className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text-mid">
              Você pode consultar este modelo, mas precisa da permissão de editar campanhas para usá-lo em um rascunho.
            </p>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
