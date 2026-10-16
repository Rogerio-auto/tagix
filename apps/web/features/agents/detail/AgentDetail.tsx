'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Bot, Power } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, EmptyState, ErrorState, Skeleton, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { AgentStatusBadge } from '../list/AgentStatusBadge';
import { useAgent, useSetAgentStatus } from '../queries';
import type { Agent } from '../types';
import { ConfigTab } from './ConfigTab';
import { KnowledgeTab } from './KnowledgeTab';
import { MetricsTab } from './MetricsTab';
import { PlaygroundPanel } from './PlaygroundTab';
import { TabNav } from './TabNav';
import { ToolsTab } from './ToolsTab';
import { AGENT_TABS, resolveTab } from './tabs';
import { VersionsPanel } from './versions';

/**
 * Shell da página de detalhe do agente (F2-S18). Cabeçalho com identidade +
 * toggle de status, nav de tabs deep-linkável (`?tab=`) e o corpo da aba ativa.
 *
 * Estados (UX §2.7 / §2.11): skeleton no loading, erro 3-partes (com 404 → "não
 * encontrado"). Cada aba tem o próprio skeleton/erro internamente.
 */
export function AgentDetail({ agentId }: { agentId: string }) {
  const searchParams = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));
  const { isMobile } = useBreakpoint();

  const role = useAuthStore((s) => s.auth?.role);
  const canEdit = role ? can(role, 'agent.edit') : false;
  const canToggle = role ? can(role, 'agent.toggle_tools') : false;
  const canViewCosts = role ? can(role, 'agent.view_costs') : false;

  const agentQuery = useAgent(agentId);
  const basePath = `/agents/${agentId}`;
  const agentLoaded = agentQuery.data?.agent;
  const action = useStatusToggle(agentLoaded ?? null);

  if (agentQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-5 w-24" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-11" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  if (agentQuery.isError) {
    const notFound = agentQuery.error instanceof ApiError && agentQuery.error.status === 404;
    if (notFound) {
      return (
        <EmptyState
          icon={Bot}
          title="Agente não encontrado"
          description="Este agente não existe ou foi removido do workspace."
          action={
            <Link
              href="/agents"
              className="rounded-sm font-body text-sm font-bold text-brand-text underline-offset-4 outline-none hover:underline focus-visible:focus-ring"
            >
              Voltar para agentes
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        title="Não foi possível carregar o agente"
        reason="A conexão com a API falhou ou expirou."
        whatToDo="Verifique sua conexão e tente novamente."
        action={
          <Button variant="secondary" onClick={() => void agentQuery.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const agent = agentQuery.data?.agent;
  if (!agent) {
    return (
      <EmptyState
        icon={Bot}
        title="Agente não encontrado"
        description="Este agente não existe ou foi removido do workspace."
        action={
          <Link
            href="/agents"
            className="rounded-sm font-body text-sm font-bold text-brand-text underline-offset-4 outline-none hover:underline focus-visible:focus-ring"
          >
            Voltar para agentes
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/agents"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm font-body text-sm text-text-low outline-none transition-colors duration-(--dur-fast) hover:text-text focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Agentes
      </Link>

      <DetailHeader agent={agent} canEdit={canEdit} action={action} isMobile={isMobile} />

      <TabNav basePath={basePath} active={activeTab} />

      <div
        role="tabpanel"
        aria-label={AGENT_TABS.find((t) => t.id === activeTab)?.label ?? activeTab}
        className={isMobile ? 'pb-2' : undefined}
      >
        {activeTab === 'config' && <ConfigTab agent={agent} canEdit={canEdit} />}
        {activeTab === 'versions' && <VersionsPanel agentId={agent.id} canEdit={canEdit} />}
        {activeTab === 'tools' && <ToolsTab agentId={agent.id} canToggle={canToggle} />}
        {activeTab === 'knowledge' && <KnowledgeTab />}
        {activeTab === 'metrics' && <MetricsTab agentId={agent.id} canViewCosts={canViewCosts} />}
        {activeTab === 'playground' && <PlaygroundPanel agentId={agent.id} />}
      </div>

      {/* Ação primária na zona do polegar (mobile), fixa no rodapé da página. */}
      {canEdit && action && isMobile && (
        <div className="pb-safe sticky inset-x-0 bottom-0 z-30 -mx-4 border-t border-border bg-surface-glass px-4 py-3 backdrop-blur">
          <ReadOnlyGuard className="w-full" align="start">
            <Button
              variant="secondary"
              className="w-full"
              loading={action.pending}
              leftIcon={<Power className="size-4" aria-hidden />}
              onClick={() => void action.run()}
            >
              {action.label}
            </Button>
          </ReadOnlyGuard>
        </div>
      )}
    </div>
  );
}

/** Ação de ativar/desativar resolvida (ou `null` p/ arquivado). Compartilhada
 * pelo botão inline (desktop, no header) e pela barra fixa no rodapé (mobile). */
interface StatusToggleAction {
  label: string;
  pending: boolean;
  run: () => Promise<void>;
}

/** Lógica de toggle de status do agente, isolada para reuso desktop/mobile. */
function useStatusToggle(agent: Agent | null): StatusToggleAction | null {
  const { toast } = useToast();
  const router = useRouter();
  const setStatus = useSetAgentStatus();

  const toggle =
    agent?.status === 'active'
      ? { label: 'Desativar', next: 'inactive' as const }
      : agent?.status === 'inactive'
        ? { label: 'Ativar', next: 'active' as const }
        : null;

  if (!agent || !toggle) return null;

  return {
    label: toggle.label,
    pending: setStatus.isPending,
    run: async () => {
      try {
        await setStatus.mutateAsync({ id: agent.id, status: toggle.next });
        toast({
          variant: 'success',
          title: toggle.next === 'active' ? 'Agente ativado' : 'Agente desativado',
          description: agent.name,
        });
        router.refresh();
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Tente novamente.';
        const ref = err instanceof ApiError ? err.ref : undefined;
        toast({
          variant: 'error',
          title: 'Falha ao atualizar o agente',
          description: ref ? `${message} (ref ${ref})` : message,
        });
      }
    },
  };
}

/**
 * Cabeçalho de identidade + ação de ativar/desativar (mesma UX do AgentCard).
 *
 * Mobile (MOBILE_UX §1 thumb-first): a identidade ocupa a largura toda e a ação
 * primária vai para uma barra fixa no rodapé da página (renderizada em
 * `AgentDetail`). Desktop: ação inline à direita do header.
 */
function DetailHeader({
  agent,
  canEdit,
  action,
  isMobile,
}: {
  agent: Agent;
  canEdit: boolean;
  action: StatusToggleAction | null;
  isMobile: boolean;
}) {
  const showInlineAction = canEdit && action && !isMobile;

  return (
    <div className="flex items-center gap-4">
      <span
        aria-hidden
        className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-text-mid"
      >
        <Bot className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="min-w-0 truncate font-head text-h4 text-text md:text-h3">{agent.name}</h1>
          <AgentStatusBadge status={agent.status} />
        </div>
        <p className="mt-1.5 truncate font-body text-small text-text-low">
          <span className="font-mono text-text-mid">{agent.model ?? 'Modelo padrão'}</span>
          {agent.description ? ` · ${agent.description}` : ''}
        </p>
      </div>
      {showInlineAction && (
        <ReadOnlyGuard>
          <Button
            variant="secondary"
            loading={action.pending}
            leftIcon={<Power className="size-4" aria-hidden />}
            onClick={() => void action.run()}
          >
            {action.label}
          </Button>
        </ReadOnlyGuard>
      )}
    </div>
  );
}
