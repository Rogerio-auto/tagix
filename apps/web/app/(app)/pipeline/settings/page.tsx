import { PipelineSettingsPage } from '@/features/pipeline/settings';
import { PageContainer } from '@/shared/components/layout';

export const metadata = {
  title: 'Configurar pipeline',
};

export default function Page() {
  return (
    <PageContainer>
      <PipelineSettingsPage />
    </PageContainer>
  );
}
