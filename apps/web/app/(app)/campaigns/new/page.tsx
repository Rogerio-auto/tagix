import { CampaignEditor } from '@/features/campaigns/editor';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Nova campanha' };

export default function Page(): React.JSX.Element {
  return (
    <PageContainer>
      <CampaignEditor />
    </PageContainer>
  );
}
