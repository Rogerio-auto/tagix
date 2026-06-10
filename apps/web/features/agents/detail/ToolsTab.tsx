'use client';

import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { Button, Card } from '@hm/ui';
import { Toggle } from '@/features/agents/wizard/fields';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { ApiError } from '@/shared/lib/api-client';
import { useToast } from '@hm/ui';
import { useAgentTools, useToggleAgentTool } from './queries';
import type { AgentToolState } from './types';

/**
 * Aba de Tools (UX §2.7 skeleton / §2.11 erro 3-partes). Lista o catálogo de
 * tools visível ao workspace com o estado por agente; cada item é um toggle
 * (`PUT /api/agents/:id/tools/:toolId`). Sem permissão `agent.toggle_tools` os
 * toggles ficam read-only.
 */
export function ToolsTab({ agentId, canToggle }: { agentId: string; canToggle: boolean }) {
  const { toast } = useToast();
  const tools = useAgentTools(agentId);
  const toggle = useToggleAgentTool(agentId);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const onToggle = async (tool: AgentToolState, next: boolean) => {
    setPendingId(tool.id);
    try {
      await toggle.mutateAsync({ toolId: tool.id, isEnabled: next });
      toast({
        variant: 'success',
        title: next ? 'Tool ativada' : 'Tool desativada',
        description: tool.name,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Falha ao atualizar a tool',
        description: ref ? `${message} (ref ${ref})` : message,
      });
    } finally {
      setPendingId(null);
    }
  };

  if (tools.isLoading) return <SkeletonList rows={4} />;

  if (tools.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as tools"
        reason="A conexão com a API falhou ou expirou."
        whatToDo="Verifique sua conexão e tente novamente."
        action={
          <Button variant="secondary" onClick={() => void tools.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const list = tools.data?.tools ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="Nenhuma tool disponível"
        description="O catálogo de tools do workspace está vazio. Tools globais e customizadas aparecem aqui quando provisionadas."
      />
    );
  }

  return (
    <Card elevation={1}>
      <ul className="divide-y divide-border-2">
        {list.map((tool) => (
          <li key={tool.id} className="flex items-center gap-4 px-5 py-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-inset text-text-mid">
              <Wrench className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate font-head text-sm font-medium text-text">
                {tool.name}
                {tool.isGlobal && (
                  <span className="rounded-pill bg-surface-3 px-2 py-0.5 font-body text-[11px] text-text-low">
                    global
                  </span>
                )}
                {tool.category && (
                  <span className="rounded-pill bg-surface-3 px-2 py-0.5 font-body text-[11px] text-text-low">
                    {tool.category}
                  </span>
                )}
              </p>
              {tool.description && (
                <p className="truncate font-body text-xs text-text-low">{tool.description}</p>
              )}
            </div>
            <div aria-busy={pendingId === tool.id || undefined}>
              <Toggle
                checked={tool.isEnabled}
                onChange={(next) => {
                  if (!canToggle || pendingId === tool.id) return;
                  void onToggle(tool, next);
                }}
                label={tool.isEnabled ? 'Ativa' : 'Inativa'}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
