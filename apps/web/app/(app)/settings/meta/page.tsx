import { MetaConnectionsPanel } from '@/features/meta-connection/MetaConnectionsPanel';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Meta — Facebook e Instagram' };

/**
 * Conexão Meta por workspace (F69-S02): o que o Leadium pode fazer na conta da
 * Meta do cliente, o que está funcionando e o que reconectar.
 */
export default function SettingsMetaPage() {
  return (
    <PageContainer>
      <MetaConnectionsPanel />
    </PageContainer>
  );
}
