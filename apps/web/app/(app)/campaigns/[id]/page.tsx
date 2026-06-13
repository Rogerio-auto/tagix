import { CampaignDetailPage } from '@/features/campaigns/list';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Campanha' };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    <PageContainer>
      <CampaignDetailPage campaignId={id} />
    </PageContainer>
  );
}
