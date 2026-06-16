'use client';

/**
 * Seletor do agente de IA que atende a conversa (F34-S04 /
 * AGENT_DEPARTMENT_ROUTING_PLAN D4). Vive dentro da seção "Agente IA" do
 * `ContactInfoPanel` (cockpit) — UX §2.3: ação no painel, não no header
 * (sem duplicar o espelho condicional).
 *
 * Mostra o agente ATUAL nomeado (não só "IA on/off") e um dropdown com os
 * agentes elegíveis ao(s) departamento(s) da conversa. Trocar dispara o
 * endpoint `POST /api/conversations/:id/agent`, que re-engaja a IA no backend.
 *
 * Regras:
 *  UX §2  — agente atual nomeado e visível.
 *  UX §2.7 — botão em loading durante a mutation; dropdown desabilitado.
 *  §3 — estados loading (skeleton) / empty (sem candidatos) tratados.
 *  DS v2 — zero hex; só tokens semânticos; focus ring `focus-visible:shadow-glow-md`.
 */

import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown } from 'lucide-react';
import { useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { Skeleton } from '@/shared/components/feedback';
import { useConversationAgent, useAssignAgent } from '../../queries';
import { useAgentChangedSocket } from '../../hooks/useAgentChangedSocket';

export interface AgentSelectorProps {
  conversationId: string;
  /** Habilita a query/ação. O caller já validou `can(role,'conversation.assign_agent')`. */
  canAssign: boolean;
}

export function AgentSelector({ conversationId, canAssign }: AgentSelectorProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useConversationAgent(conversationId, canAssign);
  const assign = useAssignAgent();

  // Reflete trocas de agente vindas de outros operadores sem reload (UX realtime).
  useAgentChangedSocket(canAssign ? conversationId : undefined);

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!canAssign) return null;

  const currentName = data?.currentAgentName ?? null;
  const currentId = data?.currentAgentId ?? null;
  const candidates = data?.candidates ?? [];

  function handlePick(agentId: string): void {
    if (assign.isPending || agentId === currentId) {
      setOpen(false);
      return;
    }
    const picked = candidates.find((c) => c.id === agentId);
    assign.mutate(
      { conversationId, agentId },
      {
        onSuccess: () => {
          toast({
            title: picked ? `Agente alterado para ${picked.name}` : 'Agente alterado',
            variant: 'success',
          });
          setOpen(false);
        },
        onError: () => toast({ title: 'Falha ao trocar de agente', variant: 'error' }),
      },
    );
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-2">
      <span className="font-body text-xs text-text-low">Agente responsável</span>

      {isLoading ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={assign.isPending}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2',
            'font-body text-sm outline-none transition-colors',
            'hover:border-border focus-visible:shadow-glow-md',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Bot className="size-4 shrink-0 text-text-low" aria-hidden />
            <span className={cn('truncate', currentName ? 'font-medium text-text' : 'text-text-low')}>
              {currentName ?? (currentId ? 'Agente atribuído' : 'Nenhum agente')}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-text-low transition-transform motion-safe:transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      )}

      {isError && (
        <p className="font-body text-xs text-danger">Não foi possível carregar os agentes.</p>
      )}

      {open && (
        <div
          role="listbox"
          aria-label="Selecionar agente"
          className="z-10 max-h-56 overflow-y-auto rounded-md border border-border bg-surface-2 p-1 shadow-glow-md"
        >
          {candidates.length === 0 ? (
            <p className="px-2 py-2 font-body text-xs text-text-low">
              Nenhum agente elegível ao departamento desta conversa.
            </p>
          ) : (
            candidates.map((agent) => {
              const isCurrent = agent.id === currentId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  disabled={assign.isPending}
                  onClick={() => handlePick(agent.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-body text-sm outline-none',
                    'hover:bg-surface-3 focus-visible:shadow-glow-md',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    isCurrent ? 'text-text' : 'text-text-mid hover:text-text',
                  )}
                >
                  <Check
                    className={cn('size-3.5 shrink-0 text-text', isCurrent ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="truncate">{agent.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
