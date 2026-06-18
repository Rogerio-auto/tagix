'use client';

import { useState } from 'react';
import { Bot, Plus } from 'lucide-react';
import { can } from '@hm/shared';
import { AnchoredHelpHint, Button, Card, useToast } from '@hm/ui';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { HelpPanel } from '@/shared/components/help';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useAgents, useSetAgentStatus } from '../queries';
import type { Agent } from '../types';
import { AgentCreationWizard } from '../wizard/AgentCreationWizard';
import { AgentCard } from './AgentCard';
import { AgentsHelp } from './help';

/**
 * Tela de listagem de agentes IA (F2-S17). Espelha o padrão de estados do
 * `ChannelsManager`: skeleton no loading, erro 3-partes, empty com CTA único.
 * O wizard de criação abre num painel (Modal) — UX §2.3.
 */
export function AgentsList() {
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
    <Button
      variant="primary"
      leftIcon={<Plus className="size-4" aria-hidden />}
      onClick={() => setWizardOpen(true)}
    >
      Criar agente
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Agentes"
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

      {agents.isLoading ? (
        <SkeletonList rows={4} />
      ) : agents.isError ? (
        <ErrorState
          title="Não foi possível carregar os agentes"
          reason="A conexão com a API falhou ou expirou."
          whatToDo="Verifique sua conexão e tente novamente."
          action={
            <Button variant="secondary" onClick={() => void agents.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : !agents.data || agents.data.agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="Nenhum agente ainda"
          description="Crie um agente IA a partir de um template para automatizar atendimento, vendas e qualificação nas suas conversas."
          action={createButton ?? undefined}
        />
      ) : isMobile ? (
        // Mobile: 1 coluna confortável de cards standalone (MOBILE_UX §2/§4 —
        // tabela/lista densa → cards escaneáveis, ação primária no corpo).
        <ul className="flex flex-col gap-2">
          {agents.data.agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              canEdit={canEdit}
              busy={pendingId === agent.id}
              onToggleActive={(a) => void toggleActive(a)}
              variant="card"
            />
          ))}
        </ul>
      ) : (
        <Card elevation={1}>
          <ul className="divide-y divide-border-2">
            {agents.data.agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                canEdit={canEdit}
                busy={pendingId === agent.id}
                onToggleActive={(a) => void toggleActive(a)}
                variant="row"
              />
            ))}
          </ul>
        </Card>
      )}

      <AgentCreationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
