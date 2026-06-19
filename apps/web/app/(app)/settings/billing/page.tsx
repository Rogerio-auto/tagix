import { Suspense } from 'react';
import { BillingPortal } from '@/features/billing';
import { PageContainer } from '@/shared/components/layout';

export const metadata = { title: 'Cobrança' };

/**
 * Billing portal self-serve (F41-S06 / PAYMENTS_ABACATEPAY.md §8). Página dedicada
 * (deep-link a partir da sidebar de settings). O portal usa `useSearchParams` para
 * tratar o retorno do checkout (`?status=…`) → exige Suspense boundary (Next 15).
 */
export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <PageContainer>
        <BillingPortal />
      </PageContainer>
    </Suspense>
  );
}
