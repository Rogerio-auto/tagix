import { CampaignsPage } from '@/features/campaigns/list';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Campanhas' };

export default function Page(): React.JSX.Element {
  return (
    <PageContainer>
      <CampaignsPage />
    </PageContainer>
  );
}
