import { Suspense } from 'react';
import { SubscriptionEditor } from '@/features/platform-admin/subscriptions';

export const metadata = { title: 'Plataforma — Assinaturas' };

export default function PlatformSubscriptionsPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionEditor />
    </Suspense>
  );
}
