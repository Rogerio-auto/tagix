'use client';

import { PlayCircle } from 'lucide-react';
import { EmptyState } from '@/shared/components/feedback';

/**
 * Aba de Playground — **seam para F2-S19**.
 *
 * F2-S18 só reserva a aba e expõe `<PlaygroundPanel agentId={id} />` como ponto
 * de extensão. F2-S19 entrega o componente real (chat de teste contra o agente);
 * quando disponível, ele substitui o placeholder abaixo (trocar o corpo deste
 * componente por `<AgentPlayground agentId={agentId} />`, sem tocar no resto da
 * página de detalhe).
 */
export function PlaygroundPanel({ agentId }: { agentId: string }) {
  // F2-S19 pluga aqui: import { AgentPlayground } from '...';
  //   return <AgentPlayground agentId={agentId} />;
  void agentId;
  return (
    <EmptyState
      icon={PlayCircle}
      title="Playground em breve"
      description="Em breve você poderá testar este agente em um chat ao vivo, com as tools e o modelo configurados, antes de colocá-lo em produção."
    />
  );
}
