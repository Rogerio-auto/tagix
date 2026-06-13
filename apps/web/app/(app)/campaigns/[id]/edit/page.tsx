import { CampaignEditor } from '@/features/campaigns/editor';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Editar campanha' };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    <PageContainer>
      <CampaignEditor campaignId={id} />
    </PageContainer>
  );
}
