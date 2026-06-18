import { Suspense } from 'react';
import { HelpReader } from '@/features/help';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Ajuda' };

export default function HelpPage() {
  return (
    <PageContainer>
      <Suspense fallback={null}>
        <HelpReader />
      </Suspense>
    </PageContainer>
  );
}
