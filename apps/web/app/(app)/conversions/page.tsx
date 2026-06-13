import { ConversionsPage } from '@/features/conversions';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Conversões' };

export default function Page() {
  return (
    <PageContainer>
      <ConversionsPage />
    </PageContainer>
  );
}
