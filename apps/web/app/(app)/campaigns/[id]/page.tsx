import { CampaignDetailPage } from '@/features/campaigns/list';

export const metadata = { title: 'Campanha' };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return <CampaignDetailPage campaignId={id} />;
}
