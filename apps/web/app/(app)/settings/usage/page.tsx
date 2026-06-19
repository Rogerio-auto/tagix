import { Suspense } from 'react';
import { WorkspaceUsage } from '@/features/usage';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Uso e custo de IA' };

/**
 * Uso e custo de IA do workspace (DASHBOARD.md §319). Destino de drill dos cards
 * "Custo IA" do dashboard. `WorkspaceUsage` lê `?period=` via useSearchParams →
 * exige Suspense boundary (Next 15).
 */
export default function SettingsUsagePage() {
  return (
    <Suspense fallback={null}>
      <PageContainer>
        <WorkspaceUsage />
      </PageContainer>
    </Suspense>
  );
}
