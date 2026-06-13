import { AgentDetail } from '@/features/agents/detail/AgentDetail';
import { PageContainer } from '@/shared/components/layout';

export const metadata = {
  title: 'Detalhe do agente',
};

/**
 * Rota de detalhe do agente (F2-S18). Next 15: `params` é assíncrono —
 * `const { id } = await params`. Renderiza o shell client-side `AgentDetail`,
 * que carrega o agente, monta as tabs (deep-linkáveis via `?tab=`) e os painéis.
 */
export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageContainer>
      <AgentDetail agentId={id} />
    </PageContainer>
  );
}
