'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Workflow } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, Card, Modal, useToast } from '@hm/ui';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { HelpPanel } from '@/shared/components/help';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { CreateFlowModal } from './CreateFlowModal';
import { FlowCard } from './FlowCard';
import { FlowsHelp } from './help';
import { ManualFlowsReorder } from './ManualFlowsReorder';
import { useDeleteFlow, useFlowLifecycle, useFlows } from './queries';
import type { Flow } from './types';

/** Tela de lista de flows (F4-S09). Estados default/empty/error 3-partes (UX secao 2.7). */
export function FlowsListPage() {
  const router = useRouter();
  const role = useAuthStore((s) => s.auth?.role);
  const canEdit = role ? can(role, 'flow.edit') : false;
  const canPublish = role ? can(role, 'flow.publish') : false;

  const { toast } = useToast();
  const flows = useFlows();
  const lifecycle = useFlowLifecycle();
  const deleteFlow = useDeleteFlow();

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [flowToDelete, setFlowToDelete] = useState<Flow | null>(null);

  const confirmDelete = async (): Promise<void> => {
    if (!flowToDelete) return;
    const flow = flowToDelete;
    try {
      await deleteFlow.mutateAsync(flow.id);
      toast({ variant: 'success', title: 'Flow excluído', description: flow.name });
      setFlowToDelete(null);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Não foi possível excluir',
        description: err instanceof ApiError ? err.message : 'Tente novamente.',
      });
    }
  };

  const runLifecycle = async (flow: Flow, action: 'publish' | 'unpublish' | 'archive') => {
    setPendingId(flow.id);
    try {
      await lifecycle.mutateAsync({ id: flow.id, action });
      const titles = {
        publish: 'Flow publicado',
        unpublish: 'Flow pausado',
        archive: 'Flow arquivado',
      } as const;
      toast({ variant: 'success', title: titles[action], description: flow.name });
    } catch (err) {
      let message = err instanceof ApiError ? err.message : 'Tente novamente.';
      if (err instanceof ApiError && err.status === 422) {
        message = 'O flow tem erros de validacao. Abra o editor para corrigir.';
      }
      toast({ variant: 'error', title: 'Falha na acao', description: message });
    } finally {
      setPendingId(null);
    }
  };

  const createButton = canEdit ? (
    <span data-tour-id="flows-create">
      <Button
        variant="primary"
        leftIcon={<Plus className="size-4" aria-hidden />}
        onClick={() => setCreateOpen(true)}
      >
        Criar flow
      </Button>
    </span>
  ) : null;

  const list = flows.data?.flows ?? [];
  const manualFlows = list.filter((f) => f.triggerType === 'manual');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Flows"
        actions={createButton}
        helpSlot={
          <HelpPanel title="Flows">
            <FlowsHelp />
          </HelpPanel>
        }
      />

      {flows.isLoading ? (
        <SkeletonList rows={4} />
      ) : flows.isError ? (
        <ErrorState
          title="Nao foi possivel carregar os flows"
          reason="A conexao com a API falhou ou expirou."
          whatToDo="Verifique sua conexao e tente novamente."
          action={
            <Button variant="secondary" onClick={() => void flows.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="Nenhum flow ainda"
          description="Crie um flow para automatizar mensagens, respostas e acoes a partir de gatilhos nas suas conversas."
          action={createButton ?? undefined}
        />
      ) : (
        <div className="space-y-6">
          <Card elevation={1} data-tour-id="flows-list">
            <ul className="divide-y divide-border-2">
              {list.map((flow) => (
                <FlowCard
                  key={flow.id}
                  flow={flow}
                  canEdit={canEdit}
                  canPublish={canPublish}
                  busy={pendingId === flow.id}
                  onPublish={(f) => void runLifecycle(f, 'publish')}
                  onUnpublish={(f) => void runLifecycle(f, 'unpublish')}
                  onArchive={(f) => void runLifecycle(f, 'archive')}
                  onDelete={(f) => setFlowToDelete(f)}
                />
              ))}
            </ul>
          </Card>

          {canEdit && manualFlows.length > 1 && <ManualFlowsReorder flows={manualFlows} />}
        </div>
      )}

      <CreateFlowModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => router.push(`/flows/${id}`)}
      />

      <Modal
        open={flowToDelete !== null}
        onClose={() => !deleteFlow.isPending && setFlowToDelete(null)}
        title="Excluir flow"
        description={
          flowToDelete
            ? `Tem certeza que deseja excluir “${flowToDelete.name}”? Esta ação é permanente e remove também o histórico de execuções. Não dá para desfazer.`
            : ''
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setFlowToDelete(null)}
              disabled={deleteFlow.isPending}
            >
              Cancelar
            </Button>
            <Button variant="danger" loading={deleteFlow.isPending} onClick={() => void confirmDelete()}>
              Excluir
            </Button>
          </>
        }
      />
    </div>
  );
}
