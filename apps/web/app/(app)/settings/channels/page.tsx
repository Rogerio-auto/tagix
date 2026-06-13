import { ChannelsManager } from '@/features/channels/components/ChannelsManager';
import { PageContainer } from '@/shared/components/layout';

export const metadata = {
  title: 'Canais · Configurações',
};

export default function ChannelsSettingsPage() {
  return (
    <PageContainer>
      <ChannelsManager />
    </PageContainer>
  );
}
