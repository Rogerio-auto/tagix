'use client';

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useConversationExecutions } from './queries';
import { ExecutionDetailDrawer } from './ExecutionDetailDrawer';

/**
 * Badge de execucoes ativas da conversa (FX-031c/d). Aparece no ChatHeader e na ChatList.
 * Click abre o drawer de detalhe da primeira execucao ativa. Nao-intrusivo; some quando 0.
 *
 * `interactive=false` (ChatList): so o contador, sem drawer (evita drill-down na lista).
 */
export function FlowExecutionsBadge({
  conversationId,
  interactive = true,
}: {
  conversationId: string;
  interactive?: boolean;
}) {
  const executions = useConversationExecutions(conversationId);
  const [openId, setOpenId] = useState<string | null>(null);
  const active = executions.data ?? [];

  if (active.length === 0) return null;

  const content = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent',
      )}
    >
      <Activity className="size-3" aria-hidden />
      {active.length} {active.length === 1 ? 'flow' : 'flows'}
    </span>
  );

  if (!interactive) return content;

  return (
    <>
      <button
        type="button"
        aria-label="Ver execucoes do flow"
        onClick={() => setOpenId(active[0]?.id ?? null)}
        className="transition-opacity hover:opacity-80"
      >
        {content}
      </button>
      <ExecutionDetailDrawer
        executionId={openId}
        conversationId={conversationId}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
