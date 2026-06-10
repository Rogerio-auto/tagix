import Link from 'next/link';
import { Bot, Cpu, Power } from 'lucide-react';
import { Button } from '@hm/ui';
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
function nextToggle(agent: Agent): { label: string; next: 'active' | 'inactive' } | null {
  if (agent.status === 'active') return { label: 'Desativar', next: 'inactive' };
  if (agent.status === 'inactive') return { label: 'Ativar', next: 'active' };
  return null; // arquivado: restaurar é fluxo de edição (F2-S18)
}

export function AgentCard({ agent, canEdit, busy, onToggleActive }: AgentCardProps) {
  const toggle = nextToggle(agent);

  return (
    <li className="flex items-center gap-4 px-5 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-inset text-text-mid">
        <Bot className="size-5" aria-hidden />
      </span>

      <Link
        href={`/agents/${agent.id}`}
        className="min-w-0 flex-1 rounded-sm outline-none focus-visible:shadow-glow-md"
      >
        <p className="truncate font-head text-sm font-semibold text-text hover:text-brand">
          {agent.name}
        </p>
        <p className="flex items-center gap-1.5 truncate font-body text-xs text-text-low">
          <Cpu className="size-3.5 shrink-0" aria-hidden />
          {agent.model ?? 'Modelo padrão'}
          {agent.description ? ` · ${agent.description}` : ''}
        </p>
      </Link>

      <AgentStatusBadge status={agent.status} />

      {canEdit && toggle && (
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          leftIcon={<Power className="size-4" aria-hidden />}
          onClick={() => onToggleActive(agent)}
        >
          {toggle.label}
        </Button>
      )}
    </li>
  );
}
