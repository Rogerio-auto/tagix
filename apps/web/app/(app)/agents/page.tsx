import { AgentsList } from '@/features/agents/list/AgentsList';
import { PageContainer } from '@/shared/components/layout';

export const metadata = {
  title: 'Agentes',
};

export default function AgentsPage() {
  return (
    <PageContainer>
      <AgentsList />
    </PageContainer>
  );
}
