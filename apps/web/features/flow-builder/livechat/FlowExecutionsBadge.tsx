'use client';

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { Badge } from '@hm/ui';
import { formatNumber } from '@/shared/lib/locale';
import { useConversationExecutions } from './queries';
import { ExecutionDetailDrawer } from './ExecutionDetailDrawer';

/**
 * Badge de execuções ativas da conversa (FX-031c/d) no DS 3.0 (F72-S07). Aparece no
 * cabeçalho da conversa e na lista. Clique abre o painel de detalhe da primeira execução
 * ativa. Não intrusivo; some quando não há execução. Contagem em mono.
 *
 * `interactive=false` (lista de conversas): só o contador, sem painel (evita drill-down na
 * lista) e sem pulso (vários itens pulsando seriam ruído).
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

  const label = `${formatNumber(active.length)} ${active.length === 1 ? 'flow ativo' : 'flows ativos'}`;
  const content = (
    <Badge tone="info" size="sm">
      <Activity className="size-3" aria-hidden />
      <span className="font-mono tabular-nums">{formatNumber(active.length)}</span>
      {active.length === 1 ? 'flow' : 'flows'}
    </Badge>
  );

  if (!interactive) return <span title={label}>{content}</span>;

  return (
    <>
      <button
        type="button"
        aria-label={`Ver execução: ${label}`}
        onClick={() => setOpenId(active[0]?.id ?? null)}
        className="rounded-pill outline-none transition-opacity hover:opacity-80 focus-visible:focus-ring"
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
