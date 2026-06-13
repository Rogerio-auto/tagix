import { KnowledgeBasePage } from '@/features/knowledge/KnowledgeBasePage';
import { PageContainer } from '@/shared/components/layout';

export const metadata = {
  title: 'Conhecimento',
};

export default function KnowledgePage() {
  return (
    <PageContainer>
      <KnowledgeBasePage />
    </PageContainer>
  );
}
