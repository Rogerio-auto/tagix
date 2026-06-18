import { DeveloperPortal } from '@/features/developers';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Leadium API — Desenvolvedores' };

export default function DevelopersPage() {
  return (
    <PageContainer>
      <DeveloperPortal />
    </PageContainer>
  );
}
