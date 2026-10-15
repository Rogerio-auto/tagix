'use client';

import Link from 'next/link';
import { Archive, Pause, Play, Trash2, Workflow } from 'lucide-react';
import { Button, IconButton } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { formatDate } from '@/shared/lib/locale';
import { FlowStatusBadge } from './FlowStatusBadge';
import type { Flow, FlowTriggerType } from './types';

export const TRIGGER_LABEL: Record<FlowTriggerType, string> = {
  manual: 'Manual',
  keyword: 'Palavra-chave',
  new_message: 'Nova mensagem',
  new_lead: 'Novo contato',
  flow_submission: 'Resposta de formulário',
  stage_change: 'Mudança de etapa',
  tag_added: 'Tag adicionada',
  system_event: 'Evento do sistema',
};

export function triggerLabel(type: string): string {
  return (TRIGGER_LABEL as Record<string, string>)[type] ?? type;
}

/** Data compacta (mono, uma linha) da última mudança do flow. */
export const FLOW_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

export interface FlowRowActionsProps {
  flow: Flow;
  canEdit: boolean;
  canPublish: boolean;
  busy: boolean;
  onPublish: (flow: Flow) => void;
  onUnpublish: (flow: Flow) => void;
  onArchive: (flow: Flow) => void;
  onDelete: (flow: Flow) => void;
  /** `card`: botões maiores para o polegar (MOBILE_UX §1). */
  variant?: 'row' | 'card';
}

/**
 * Ações de escrita de um flow: publicar ou pausar, arquivar e excluir. Cada uma passa pela
 * guarda de só leitura (F71-S17): focável, `aria-disabled`, com a explicação. Excluir só
 * PEDE a confirmação (`onDelete`); quem confirma é o diálogo da página (UX §2.9).
 * Rótulos acessíveis com o nome do flow: numa tabela há vários "Publicar" iguais.
 */
export function FlowRowActions({
  flow,
  canEdit,
  canPublish,
  busy,
  onPublish,
  onUnpublish,
  onArchive,
  onDelete,
  variant = 'row',
}: FlowRowActionsProps) {
  const isArchived = flow.status === 'archived';
  const card = variant === 'card';
  const size = card ? 'md' : 'sm';

  const lifecycle =
    canPublish && !isArchived ? (
      flow.status === 'active' ? (
        <ReadOnlyGuard className={cn(card && 'flex-1')} align={card ? 'start' : 'end'}>
          <Button
            variant="secondary"
            size={size}
            className={cn(card && 'w-full')}
            loading={busy}
            aria-label={`Pausar ${flow.name}`}
            leftIcon={<Pause className="size-3.5" aria-hidden />}
            onClick={() => onUnpublish(flow)}
          >
            Pausar
          </Button>
        </ReadOnlyGuard>
      ) : (
        <ReadOnlyGuard className={cn(card && 'flex-1')} align={card ? 'start' : 'end'}>
          <Button
            variant="secondary"
            size={size}
            className={cn(card && 'w-full')}
            loading={busy}
            aria-label={`Publicar ${flow.name}`}
            leftIcon={<Play className="size-3.5" aria-hidden />}
            onClick={() => onPublish(flow)}
          >
            Publicar
          </Button>
        </ReadOnlyGuard>
      )
    ) : null;

  if (!lifecycle && !canEdit) return null;

  return (
    <div className={cn('flex items-center gap-1', card ? 'w-full' : 'justify-end')}>
      {lifecycle}
      {canEdit && !isArchived && (
        <ReadOnlyGuard>
          <IconButton
            size={card ? 'md' : 'sm'}
            variant={card ? 'solid' : 'ghost'}
            icon={<Archive />}
            disabled={busy}
            title="Arquivar"
            aria-label={`Arquivar ${flow.name}`}
            onClick={() => onArchive(flow)}
          />
        </ReadOnlyGuard>
      )}
      {canEdit && (
        <ReadOnlyGuard>
          <IconButton
            size={card ? 'md' : 'sm'}
            variant="danger"
            icon={<Trash2 />}
            disabled={busy}
            title="Excluir"
            aria-label={`Excluir ${flow.name}`}
            onClick={() => onDelete(flow)}
          />
        </ReadOnlyGuard>
      )}
    </div>
  );
}

/**
 * Card do flow no celular (MOBILE_UX §1/§4): identidade no corpo (link para o editor) e as
 * ações no rodapé, na zona do polegar. O link e os botões são irmãos, nunca aninhados.
 * No desktop a lista é o `DataTable` de `FlowsListPage`.
 */
export function FlowCard(props: Omit<FlowRowActionsProps, 'variant'>) {
  const { flow } = props;
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4',
        flow.status === 'archived' && 'bg-bg-alt',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-mid"
        >
          <Workflow className="size-5" />
        </span>
        <Link
          href={`/flows/${flow.id}`}
          className="min-w-0 flex-1 rounded-sm outline-none focus-visible:focus-ring"
          aria-label={`Abrir flow ${flow.name}`}
        >
          <p className="truncate font-head text-base font-medium text-text">{flow.name}</p>
          <p className="truncate text-sm text-text-low">{triggerLabel(flow.triggerType)}</p>
        </Link>
        <FlowStatusBadge status={flow.status} />
      </div>

      {flow.description ? <p className="line-clamp-2 text-sm text-text-mid">{flow.description}</p> : null}

      <p className="font-mono text-xs tabular-nums text-text-low">
        Atualizado em {formatDate(flow.updatedAt ?? flow.createdAt, FLOW_DATE)}
      </p>

      <FlowRowActions {...props} variant="card" />
    </li>
  );
}
