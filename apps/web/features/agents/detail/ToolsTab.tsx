'use client';

import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Skeleton, Switch, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { ApiError } from '@/shared/lib/api-client';
import { useAgentTools, useToggleAgentTool } from './queries';
import type { AgentToolState } from './types';

/**
 * Aba de Tools (UX §2.7 skeleton / §2.11 erro 3-partes). Lista o catálogo de
 * tools visível ao workspace com o estado por agente; cada item é um toggle
 * (`PUT /api/agents/:id/tools/:toolId`). Sem permissão `agent.toggle_tools` os
 * toggles ficam read-only; em empresa só leitura, `aria-disabled` com a explicação
 * (F71-S17). DS 3.0 (F72-S07): `Switch` do `@hm/ui`, rótulo com o nome da tool.
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

  if (tools.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy aria-label="Carregando ferramentas">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (tools.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as tools"
        reason="A conexão com a API falhou ou expirou."
        whatToDo="Verifique sua conexão e tente novamente."
        action={
          <Button variant="secondary" loading={tools.isFetching} onClick={() => void tools.refetch()}>
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
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {list.map((tool) => (
        <li key={tool.id} className="flex items-center gap-4 px-5 py-4">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-mid"
          >
            <Wrench className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 flex-wrap items-center gap-2 font-body text-sm font-bold text-text">
              <span className="truncate">{tool.name}</span>
              {tool.isGlobal && (
                <Badge tone="neutral" size="sm">
                  global
                </Badge>
              )}
              {tool.category && (
                <Badge tone="neutral" size="sm">
                  {tool.category}
                </Badge>
              )}
            </p>
            {tool.description && (
              <p className="truncate font-body text-xs text-text-low">{tool.description}</p>
            )}
          </div>
          {/* Estado visível; o leitor de tela lê o nome da tool + `aria-checked`. */}
          <span aria-hidden className="hidden w-14 text-right font-body text-xs text-text-low sm:inline">
            {tool.isEnabled ? 'Ativa' : 'Inativa'}
          </span>
          <ReadOnlyGuard>
            <Switch
              checked={tool.isEnabled}
              disabled={!canToggle}
              loading={pendingId === tool.id}
              aria-label={tool.name}
              onCheckedChange={(next) => {
                if (!canToggle || pendingId === tool.id) return;
                void onToggle(tool, next);
              }}
            />
          </ReadOnlyGuard>
        </li>
      ))}
    </ul>
  );
}
