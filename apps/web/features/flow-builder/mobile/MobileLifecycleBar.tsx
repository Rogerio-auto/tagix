'use client';

import { useState } from 'react';
import { Archive, MoreHorizontal, Pause, Save, Send } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { ApiError } from '@/shared/lib/api-client';
import { useFlowLifecycleAction } from '../hooks/useFlow';
import type { FlowDetail } from '../services';

interface Props {
  flowId: string;
  status: FlowDetail['status'];
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  canPublish: boolean;
  onSave: () => void;
  onPublish: () => void;
}

/**
 * Rodapé de ciclo de vida do editor no mobile (F36-S11, MOBILE_UX §1 — thumb-first: a ação
 * primária mora na zona do polegar com `pb-safe`). Salvar + Publicar inline; pausar/arquivar num
 * bottom-`Sheet` de "mais ações". Arquivar é destrutivo → confirmação proporcional (UX §2.9).
 */
export function MobileLifecycleBar({
  flowId,
  status,
  dirty,
  saving,
  publishing,
  canPublish,
  onSave,
  onPublish,
}: Props): React.JSX.Element {
  const { toast } = useToast();
  const lifecycle = useFlowLifecycleAction(flowId);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const isActive = status === 'active';
  const isArchived = status === 'archived';

  const run = async (action: 'unpublish' | 'archive') => {
    try {
      await lifecycle.mutateAsync(action);
      toast({
        variant: 'success',
        title: action === 'unpublish' ? 'Flow pausado' : 'Flow arquivado',
      });
      setActionsOpen(false);
      setConfirmArchive(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha na ação', description: message });
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-t border-border-2 bg-surface-1 px-3 py-2.5 pb-safe-4">
        <Button
          variant="secondary"
          size="md"
          className="flex-1"
          disabled={saving || !dirty}
          leftIcon={<Save className="size-4" aria-hidden />}
          onClick={onSave}
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
        {canPublish && !isArchived && (
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            disabled={publishing || isActive}
            leftIcon={<Send className="size-4" aria-hidden />}
            onClick={onPublish}
          >
            {publishing ? 'Publicando...' : isActive ? 'Publicado' : 'Publicar'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="md"
          className="touch-target shrink-0"
          aria-label="Mais ações do flow"
          onClick={() => setActionsOpen(true)}
        >
          <MoreHorizontal className="size-5" aria-hidden />
        </Button>
      </div>

      <Sheet
        open={actionsOpen}
        onClose={() => {
          setActionsOpen(false);
          setConfirmArchive(false);
        }}
        variant="bottom"
        title="Ações do flow"
      >
        <div className="flex flex-col gap-2 pb-2">
          {canPublish && isActive && (
            <Button
              variant="secondary"
              size="md"
              className="w-full justify-start"
              disabled={lifecycle.isPending}
              leftIcon={<Pause className="size-4" aria-hidden />}
              onClick={() => void run('unpublish')}
            >
              Pausar flow
            </Button>
          )}

          {!isArchived && !confirmArchive && (
            <Button
              variant="ghost"
              size="md"
              className="w-full justify-start text-danger"
              leftIcon={<Archive className="size-4" aria-hidden />}
              onClick={() => setConfirmArchive(true)}
            >
              Arquivar flow
            </Button>
          )}

          {!isArchived && confirmArchive && (
            <div className="rounded-md border border-border-2 bg-surface-2 p-3">
              <p className="mb-3 text-sm text-text">
                Arquivar este flow? Ele para de disparar e sai da lista ativa.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  onClick={() => setConfirmArchive(false)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  disabled={lifecycle.isPending}
                  onClick={() => void run('archive')}
                >
                  {lifecycle.isPending ? 'Arquivando...' : 'Arquivar'}
                </Button>
              </div>
            </div>
          )}

          {isArchived && (
            <p className="px-1 py-2 text-sm text-text-low">Este flow está arquivado.</p>
          )}
        </div>
      </Sheet>
    </>
  );
}
