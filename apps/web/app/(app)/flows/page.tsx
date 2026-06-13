import { FlowsListPage } from '@/features/flow-builder/list/FlowsListPage';
import { PageContainer } from '@/shared/components/layout';

export const metadata = {
  title: 'Flows',
};

export default function FlowsPage() {
  return (
    <PageContainer>
      <FlowsListPage />
    </PageContainer>
  );
}
