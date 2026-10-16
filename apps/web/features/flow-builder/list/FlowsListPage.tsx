'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DatabaseBackup, Plus, Workflow } from 'lucide-react';
import { can } from '@hm/shared';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  useToast,
  type DataTableColumn,
} from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { HelpPanel } from '@/shared/components/help';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { formatDate, formatNumber } from '@/shared/lib/locale';
import { useAuthStore } from '@/shared/stores/auth.store';
import { CreateFlowModal } from './CreateFlowModal';
import { FLOW_DATE, FlowCard, FlowRowActions, triggerLabel } from './FlowCard';
import { FlowStatusBadge } from './FlowStatusBadge';
import { FlowsHelp } from './help';
import { ManualFlowsReorder } from './ManualFlowsReorder';
import { useDeleteFlow, useFlowLifecycle, useFlows } from './queries';
import type { Flow } from './types';

type LifecycleAction = 'publish' | 'unpublish' | 'archive';

const LIFECYCLE_TITLE: Record<LifecycleAction, string> = {
  publish: 'Flow publicado',
  unpublish: 'Flow pausado',
  archive: 'Flow arquivado',
};

/**
 * Lista de flows (F4-S09) no DS 3.0 (F72-S07).
 *
 * Desktop: `DataTable` operacional (gatilho, status e data em mono; a linha abre o editor).
 * Mobile: cards com as ações no rodapé (MOBILE_UX §1/§4). Contagens do cabeçalho em mono.
 *
 * UX: §2.1 clique na linha abre o editor; §2.5 `?` (HelpPanel); §2.6 vazio com CTA único;
 * §2.7 skeleton no formato da tabela e botões em loading; §2.9 excluir pede confirmação
 * (é permanente); §2.10 teclado na tabela (Tab/Enter/setas); §2.11 erro em 3 partes.
 * Só leitura (F71-S17): criar, publicar, pausar, arquivar, excluir e reordenar ficam
 * `aria-disabled` com a explicação.
 */
export function FlowsListPage() {
  const router = useRouter();
  const role = useAuthStore((s) => s.auth?.role);
  const canEdit = role ? can(role, 'flow.edit') : false;
  const canPublish = role ? can(role, 'flow.publish') : false;
  const canBackup = role ? can(role, 'flow.backup') : false;
  const { isMobile } = useBreakpoint();

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

  const runLifecycle = async (flow: Flow, action: LifecycleAction): Promise<void> => {
    setPendingId(flow.id);
    try {
      await lifecycle.mutateAsync({ id: flow.id, action });
      toast({ variant: 'success', title: LIFECYCLE_TITLE[action], description: flow.name });
    } catch (err) {
      let message = err instanceof ApiError ? err.message : 'Tente novamente.';
      if (err instanceof ApiError && err.status === 422) {
        message = 'O flow tem erros de validação. Abra o editor para corrigir.';
      }
      toast({ variant: 'error', title: 'Não foi possível concluir a ação', description: message });
    } finally {
      setPendingId(null);
    }
  };

  const createButton = (label: string) =>
    canEdit ? (
      <span data-tour-id="flows-create" className="inline-flex">
        <ReadOnlyGuard>
          <Button variant="primary" leftIcon={<Plus className="size-4" aria-hidden />} onClick={() => setCreateOpen(true)}>
            {label}
          </Button>
        </ReadOnlyGuard>
      </span>
    ) : null;

  // Backup é leitura (exportar) + importação guardada na própria tela: o link fica livre.
  const backupLink = canBackup ? (
    <Link
      href="/flows/backup"
      className="inline-flex h-10 items-center gap-2 rounded-sm border border-border bg-surface-2 px-4 font-body text-sm font-bold text-text outline-none transition-colors duration-(--dur-base) ease-ds hover:border-border-2 hover:bg-surface-3 focus-visible:focus-ring"
    >
      <DatabaseBackup className="size-4" aria-hidden />
      Backup
    </Link>
  ) : null;

  const list = flows.data?.flows ?? [];
  const activeCount = list.filter((f) => f.status === 'active').length;
  const manualFlows = list.filter((f) => f.triggerType === 'manual' && f.status !== 'archived');

  const actionProps = (flow: Flow) => ({
    flow,
    canEdit,
    canPublish,
    busy: pendingId === flow.id,
    onPublish: (f: Flow) => void runLifecycle(f, 'publish'),
    onUnpublish: (f: Flow) => void runLifecycle(f, 'unpublish'),
    onArchive: (f: Flow) => void runLifecycle(f, 'archive'),
    onDelete: (f: Flow) => setFlowToDelete(f),
  });

  const columns: DataTableColumn<Flow>[] = [
    {
      id: 'name',
      header: 'Flow',
      cell: (f) => (
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-mid"
          >
            <Workflow className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-bold text-text">{f.name}</span>
            {f.description ? <span className="truncate text-xs text-text-low">{f.description}</span> : null}
          </span>
        </span>
      ),
    },
    {
      id: 'trigger',
      header: 'Gatilho',
      width: '13rem',
      cell: (f) => <span className="block truncate text-text-mid">{triggerLabel(f.triggerType)}</span>,
    },
    { id: 'status', header: 'Status', width: '8.5rem', cell: (f) => <FlowStatusBadge status={f.status} /> },
    {
      id: 'updatedAt',
      header: 'Atualizado em',
      numeric: true,
      width: '9rem',
      cell: (f) => <span className="whitespace-nowrap text-text-mid">{formatDate(f.updatedAt ?? f.createdAt, FLOW_DATE)}</span>,
    },
    ...(canEdit || canPublish
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Ações</span>,
            headerLabel: 'Ações',
            align: 'right' as const,
            width: '11rem',
            // Só para a propagação: os botões não abrem o editor (a linha é a ação primária).
            cell: (f: Flow) => (
              <div onClick={(e) => e.stopPropagation()}>
                <FlowRowActions {...actionProps(f)} />
              </div>
            ),
          },
        ]
      : []),
  ];

  const description = flows.data ? (
    <span>
      <span className="font-mono tabular-nums text-text-mid">{formatNumber(list.length)}</span>{' '}
      {list.length === 1 ? 'flow' : 'flows'} ·{' '}
      <span className="font-mono tabular-nums text-text-mid">{formatNumber(activeCount)}</span>{' '}
      {activeCount === 1 ? 'ativo' : 'ativos'}
      {manualFlows.length > 0 ? (
        <>
          {' · '}
          <span className="font-mono tabular-nums text-text-mid">{formatNumber(manualFlows.length)}</span>{' '}
          {manualFlows.length === 1 ? 'manual' : 'manuais'}
        </>
      ) : null}
    </span>
  ) : (
    'Automações por gatilho: mensagens, respostas e ações nas suas conversas.'
  );

  const errorState = (
    <ErrorState
      title="Não foi possível carregar os flows"
      reason="A conexão com a API falhou ou expirou."
      whatToDo="Verifique sua conexão e tente novamente."
      action={
        <Button variant="secondary" loading={flows.isFetching} onClick={() => void flows.refetch()}>
          Tentar de novo
        </Button>
      }
    />
  );
  const emptyState = (
    <EmptyState
      icon={Workflow}
      title="Nenhum flow ainda"
      description="Crie um flow para automatizar mensagens, respostas e ações a partir de gatilhos nas suas conversas."
      action={createButton('Criar flow') ?? undefined}
    />
  );

  return (
    <div>
      <PageHeader
        title="Flows"
        description={description}
        actions={
          backupLink || canEdit ? (
            <>
              {backupLink}
              {createButton('Criar flow')}
            </>
          ) : undefined
        }
        helpSlot={
          <HelpPanel title="Flows">
            <FlowsHelp />
          </HelpPanel>
        }
      />

      <div className="flex flex-col gap-8">
        {isMobile ? (
          flows.isLoading ? (
            <div className="flex flex-col gap-2" aria-busy aria-label="Carregando flows">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-lg" />
              ))}
            </div>
          ) : flows.isError ? (
            errorState
          ) : list.length === 0 ? (
            emptyState
          ) : (
            <ul className="flex flex-col gap-2" data-tour-id="flows-list" aria-label="Flows">
              {list.map((flow) => (
                <FlowCard key={flow.id} {...actionProps(flow)} />
              ))}
            </ul>
          )
        ) : (
          <div data-tour-id="flows-list">
            <DataTable<Flow>
              caption="Flows"
              columns={columns}
              rows={list}
              getRowId={(f) => f.id}
              loading={flows.isLoading}
              loadingRows={4}
              onRowClick={(f) => router.push(`/flows/${f.id}`)}
              getRowLabel={(f) => `Abrir flow ${f.name}`}
              getRowState={(f) => (f.status === 'archived' ? 'muted' : f.status === 'paused' ? 'attention' : undefined)}
              error={flows.isError ? errorState : undefined}
              empty={emptyState}
            />
          </div>
        )}

        {canEdit && manualFlows.length > 1 && <ManualFlowsReorder flows={manualFlows} />}
      </div>

      <CreateFlowModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => router.push(`/flows/${id}`)}
      />

      <Modal
        open={flowToDelete !== null}
        onClose={() => !deleteFlow.isPending && setFlowToDelete(null)}
        title="Excluir flow?"
        description={
          flowToDelete
            ? `“${flowToDelete.name}” e o histórico de execuções serão apagados de vez. Não dá para desfazer.`
            : ''
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setFlowToDelete(null)} disabled={deleteFlow.isPending}>
              Cancelar
            </Button>
            <Button variant="danger" loading={deleteFlow.isPending} onClick={() => void confirmDelete()}>
              Excluir flow
            </Button>
          </>
        }
      />
    </div>
  );
}
