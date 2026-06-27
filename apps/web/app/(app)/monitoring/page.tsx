import { SyncHealthPanel } from '@/features/monitoring';
import { PageContainer } from '@/shared/components/layout';

export const metadata = {
  title: 'Monitoramento',
};

// F52-S09: painel operacional de saúde da sincronização (filas/DLQ/ticks/canais).
// O acesso é controlado pelo backend (GET /api/monitoring/sync-health → 403 para
// quem não é OWNER/ADMIN/platform-admin); o item de nav também esconde por role.
export default function MonitoringPage() {
  return (
    <PageContainer>
      <SyncHealthPanel />
    </PageContainer>
  );
}
