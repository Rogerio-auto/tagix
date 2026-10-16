import Link from 'next/link';
import { Bot, Power } from 'lucide-react';
import { Button } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import type { Agent } from '../types';
import { AgentStatusBadge } from './AgentStatusBadge';

export interface AgentCardProps {
  agent: Agent;
  /** OWNER/ADMIN — pode ativar/desativar (permissão `agent.edit`). */
  canEdit: boolean;
  busy: boolean;
  onToggleActive: (agent: Agent) => void;
}

/** Próxima ação de toggle para um agente (arquivados não togglam aqui). */
export function nextToggle(agent: Agent): { label: string; next: 'active' | 'inactive' } | null {
  if (agent.status === 'active') return { label: 'Desativar', next: 'inactive' };
  if (agent.status === 'inactive') return { label: 'Ativar', next: 'active' };
  return null; // arquivado: restaurar é fluxo de edição (F2-S18)
}

/**
 * Card do agente no celular (MOBILE_UX §1/§4): identidade no corpo (link para o detalhe)
 * e a ação no rodapé, na zona do polegar. O link e o botão são irmãos, nunca aninhados.
 * No desktop a lista é o `DataTable` de `AgentsList`.
 */
export function AgentCard({ agent, canEdit, busy, onToggleActive }: AgentCardProps) {
  const toggle = nextToggle(agent);

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-mid">
          <Bot className="size-5" aria-hidden />
        </span>
        <Link
          href={`/agents/${agent.id}`}
          className="min-w-0 flex-1 rounded-sm outline-none focus-visible:focus-ring"
          aria-label={`Abrir ${agent.name}`}
        >
          <p className="truncate font-head text-base font-medium text-text">{agent.name}</p>
          <p className="truncate font-mono text-xs text-text-low">{agent.model ?? 'Modelo padrão'}</p>
        </Link>
        <AgentStatusBadge status={agent.status} />
      </div>

      {agent.description ? <p className="line-clamp-2 text-sm text-text-mid">{agent.description}</p> : null}

      {canEdit && toggle && (
        <ReadOnlyGuard className="w-full" align="start">
          <Button
            variant="secondary"
            size="md"
            className="w-full"
            loading={busy}
            leftIcon={<Power className="size-4" aria-hidden />}
            onClick={() => onToggleActive(agent)}
          >
            {toggle.label}
          </Button>
        </ReadOnlyGuard>
      )}
    </li>
  );
}
