'use client';

import { AgentPlayground } from '@/features/agents/playground';

/**
 * Aba de Playground (F2-S18 reserva a aba; F2-S19 entrega o chat de teste real).
 * O componente `AgentPlayground` faz o stream SSE contra `/api/agents/:id/playground`
 * (proxy do runtime, `is_playground` — não cria conversas/mensagens reais).
 */
export function PlaygroundPanel({ agentId }: { agentId: string }) {
  return <AgentPlayground agentId={agentId} />;
}
