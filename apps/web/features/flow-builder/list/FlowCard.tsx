'use client';

import Link from 'next/link';
import { Archive, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { Button } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { FlowStatusBadge } from './FlowStatusBadge';
import type { Flow } from './types';

interface Props {
  flow: Flow;
  canEdit: boolean;
  canPublish: boolean;
  busy: boolean;
  onPublish: (flow: Flow) => void;
  onUnpublish: (flow: Flow) => void;
  onArchive: (flow: Flow) => void;
  onDelete: (flow: Flow) => void;
}

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual',
  keyword: 'Palavra-chave',
  new_message: 'Nova mensagem',
  new_lead: 'Novo contato',
  flow_submission: 'Resposta de formulario',
  stage_change: 'Mudanca de etapa',
  tag_added: 'Tag adicionada',
  system_event: 'Evento do sistema',
};

export function FlowCard({
  flow,
  canEdit,
  canPublish,
  busy,
  onPublish,
  onUnpublish,
  onArchive,
  onDelete,
}: Props) {
  const isArchived = flow.status === 'archived';
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <FlowStatusBadge status={flow.status} />
          <span className="truncate font-head text-sm font-semibold text-text">{flow.name}</span>
        </div>
        <p className="mt-1 truncate text-xs text-text-low">
          {TRIGGER_LABEL[flow.triggerType] ?? flow.triggerType}
          {flow.description ? ` · ${flow.description}` : ''}
        </p>
      </div>

      <div className={cn('flex shrink-0 items-center gap-1.5')}>
        {canEdit && !isArchived && (
          <Link
            href={`/flows/${flow.id}`}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-head text-sm font-medium text-text-low transition-colors hover:bg-surface-3 hover:text-text"
          >
            <Pencil className="size-3.5" aria-hidden />
            Editar
          </Link>
        )}
        {canPublish && flow.status !== 'active' && !isArchived && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            leftIcon={<Play className="size-3.5" aria-hidden />}
            onClick={() => onPublish(flow)}
          >
            Publicar
          </Button>
        )}
        {canPublish && flow.status === 'active' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            leftIcon={<Pause className="size-3.5" aria-hidden />}
            onClick={() => onUnpublish(flow)}
          >
            Pausar
          </Button>
        )}
        {canEdit && !isArchived && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            leftIcon={<Archive className="size-3.5" aria-hidden />}
            onClick={() => onArchive(flow)}
          >
            Arquivar
          </Button>
        )}
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            leftIcon={<Trash2 className="size-3.5" aria-hidden />}
            onClick={() => onDelete(flow)}
            className="text-danger hover:bg-danger/10 hover:text-danger"
            aria-label={`Excluir flow ${flow.name}`}
          >
            Excluir
          </Button>
        )}
      </div>
    </li>
  );
}
