'use client';

/**
 * Bloqueio quando o modelo escolhido deixou de valer (F58-S09).
 *
 * A Meta pausa e rejeita modelos sem avisar ninguém — às vezes no meio da
 * montagem da campanha. A etapa não pode deixar avançar com um modelo que o
 * envio vai recusar, e também não pode só dizer "erro": diz o que aconteceu
 * (quando a central de modelos sabe), e oferece as duas saídas reais —
 * escolher outro ou sincronizar, se a pessoa acha que a Meta já liberou.
 */
import type * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@hm/ui';
import { templateStatus } from '@/features/channels/message-templates/format';
import { friendlyTemplateName } from './model';
import { useSyncTemplates, useTemplateSituation } from './queries';

export interface TemplateUnavailableProps {
  readonly channelId: string;
  readonly templateName: string;
  readonly languageCode: string;
  readonly onChooseAnother: () => void;
  readonly disabled?: boolean;
}

export function TemplateUnavailable({
  channelId,
  templateName,
  languageCode,
  onChooseAnother,
  disabled = false,
}: TemplateUnavailableProps): React.JSX.Element {
  const situation = useTemplateSituation(channelId, templateName, languageCode, true);
  const sync = useSyncTemplates(channelId);

  const entry = situation.data ?? null;
  const presentation = entry ? templateStatus(entry) : null;

  const syncError =
    sync.error?.status === 403
      ? 'Só administradores podem sincronizar. Peça a um administrador ou escolha outro modelo.'
      : (sync.error?.message ?? null);

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger-bg px-3 py-3"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text">
            “{friendlyTemplateName(templateName)}” não pode mais ser usado
            {presentation ? ` · ${presentation.label}` : ''}
          </p>
          <p className="text-xs text-text-mid">
            {entry === null
              ? 'Ele não aparece mais entre os modelos aprovados deste número. A campanha não avança com ele.'
              : presentation?.guidance}
          </p>
          {entry?.rejectionReason ? (
            <p className="text-xs text-text-low">
              Motivo informado pela Meta: {entry.rejectionReason}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={disabled} onClick={onChooseAnother}>
          Escolher outro modelo
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || sync.isPending}
          loading={sync.isPending}
          onClick={() => sync.mutate()}
        >
          Sincronizar com a Meta
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-xs empty:hidden">
        {sync.isSuccess ? (
          <span className="text-text-mid">
            Sincronizado. Se o modelo voltou a ser aprovado, este aviso some sozinho.
          </span>
        ) : syncError ? (
          <span className="text-danger">{syncError}</span>
        ) : null}
      </p>
    </div>
  );
}
