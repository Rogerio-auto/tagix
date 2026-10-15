'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Plus, Power } from 'lucide-react';
import { can } from '@hm/shared';
import {
  AnchoredHelpHint,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
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
import { useAgents, useSetAgentStatus } from '../queries';
import type { Agent } from '../types';
import { AgentCreationWizard } from '../wizard/AgentCreationWizard';
import { AgentCard, nextToggle } from './AgentCard';
import { AgentStatusBadge } from './AgentStatusBadge';
import { AgentsHelp } from './help';

/**
 * Lista de agentes IA (F2-S17) no DS 3.0 (F72-S07).
 *
 * Desktop: `DataTable` operacional (modelo em mono, data em mono à direita, linha clicável
 * abre o detalhe). Mobile: cards com a ação no rodapé (MOBILE_UX §1/§4). O wizard de
 * criação abre num painel (UX §2.3).
 *
 * UX: §2.1 clique na linha; §2.5 `?` (HelpPanel + dica ancorada); §2.6 vazio com CTA
 * único; §2.7 skeleton no formato da tabela e botão em loading no toggle; §2.10 teclado
 * na tabela; §2.11 erro em 3 partes. Só leitura: "Criar agente" e ativar/desativar ficam
 * `aria-disabled` com a explicação (F71-S17).
 */
export function AgentsList() {
  const router = useRouter();
  const role = useAuthStore((s) => s.auth?.role);
  const canEdit = role ? can(role, 'agent.edit') : false;

  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const agents = useAgents();
  const setStatus = useSetAgentStatus();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const toggleActive = async (agent: Agent) => {
    const next = agent.status === 'active' ? 'inactive' : 'active';
    setPendingId(agent.id);
    try {
      await setStatus.mutateAsync({ id: agent.id, status: next });
      toast({
        variant: 'success',
        title: next === 'active' ? 'Agente ativado' : 'Agente desativado',
        description: agent.name,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Falha ao atualizar o agente',
        description: ref ? `${message} (ref ${ref})` : message,
      });
    } finally {
      setPendingId(null);
    }
  };

  const createButton = canEdit ? (
    <span data-tour-id="agents-create" className="inline-flex">
      <ReadOnlyGuard>
        <Button
          variant="primary"
          leftIcon={<Plus className="size-4" aria-hidden />}
          onClick={() => setWizardOpen(true)}
        >
          Criar agente
        </Button>
      </ReadOnlyGuard>
    </span>
  ) : null;

  const list = agents.data?.agents ?? [];
  const activeCount = list.filter((a) => a.status === 'active').length;

  const columns: DataTableColumn<Agent>[] = [
    {
      id: 'name',
      header: 'Agente',
      cell: (a) => (
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-mid"
          >
            <Bot className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-bold text-text">{a.name}</span>
            {a.description ? <span className="truncate text-xs text-text-low">{a.description}</span> : null}
          </span>
        </span>
      ),
    },
    {
      id: 'model',
      header: 'Modelo',
      width: '16rem',
      cell: (a) => <span className="block truncate font-mono text-sm text-text-mid">{a.model ?? 'Modelo padrão'}</span>,
    },
    { id: 'status', header: 'Status', width: '8rem', cell: (a) => <AgentStatusBadge status={a.status} /> },
    {
      id: 'updatedAt',
      header: 'Atualizado em',
      numeric: true,
      width: '9rem',
      cell: (a) => (
        <span className="whitespace-nowrap text-text-mid">
          {formatDate(a.updatedAt ?? a.createdAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Ações</span>,
            headerLabel: 'Ações',
            align: 'right' as const,
            width: '9rem',
            cell: (a: Agent) => {
              const toggle = nextToggle(a);
              if (!toggle) return null;
              return (
                // Só para a propagação: o botão não abre o detalhe (a linha é a ação primária).
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <ReadOnlyGuard>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={pendingId === a.id}
                      aria-label={`${toggle.label} ${a.name}`}
                      leftIcon={<Power className="size-4" aria-hidden />}
                      onClick={() => void toggleActive(a)}
                    >
                      {toggle.label}
                    </Button>
                  </ReadOnlyGuard>
                </div>
              );
            },
          },
        ]
      : []),
  ];

  const description = agents.data ? (
    <span>
      <span className="font-mono tabular-nums text-text-mid">{formatNumber(list.length)}</span>{' '}
      {list.length === 1 ? 'agente' : 'agentes'} ·{' '}
      <span className="font-mono tabular-nums text-text-mid">{formatNumber(activeCount)}</span>{' '}
      {activeCount === 1 ? 'ativo' : 'ativos'}
    </span>
  ) : (
    'Agentes IA que atendem, vendem e qualificam nas suas conversas.'
  );

  const errorState = (
    <ErrorState
      title="Não foi possível carregar os agentes"
      reason="A conexão com a API falhou ou expirou."
      whatToDo="Verifique sua conexão e tente novamente."
      action={
        <Button variant="secondary" loading={agents.isFetching} onClick={() => void agents.refetch()}>
          Tentar de novo
        </Button>
      }
    />
  );
  const emptyState = (
    <EmptyState
      icon={Bot}
      title="Nenhum agente ainda"
      description="Crie um agente IA a partir de um template para automatizar atendimento, vendas e qualificação nas suas conversas."
      action={createButton ?? undefined}
    />
  );

  return (
    <div>
      <PageHeader
        title="Agentes"
        description={description}
        actions={createButton}
        helpSlot={
          <span className="flex items-center gap-1">
            <HelpPanel title="Agentes">
              <AgentsHelp />
            </HelpPanel>
            <AnchoredHelpHint anchorKey="agents.list" />
          </span>
        }
      />

      {isMobile ? (
        agents.isLoading ? (
          <div className="flex flex-col gap-2" aria-busy aria-label="Carregando agentes">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-lg" />
            ))}
          </div>
        ) : agents.isError ? (
          errorState
        ) : list.length === 0 ? (
          emptyState
        ) : (
          <ul className="flex flex-col gap-2" data-tour-id="agents-list">
            {list.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                canEdit={canEdit}
                busy={pendingId === agent.id}
                onToggleActive={(a) => void toggleActive(a)}
              />
            ))}
          </ul>
        )
      ) : (
        <div data-tour-id="agents-list">
          <DataTable<Agent>
            caption="Agentes"
            columns={columns}
            rows={list}
            getRowId={(a) => a.id}
            loading={agents.isLoading}
            loadingRows={4}
            onRowClick={(a) => router.push(`/agents/${a.id}`)}
            getRowLabel={(a) => `Abrir agente ${a.name}`}
            getRowState={(a) => (a.status === 'archived' ? 'muted' : undefined)}
            error={agents.isError ? errorState : undefined}
            empty={emptyState}
          />
        </div>
      )}

      <AgentCreationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
