import { Suspense } from 'react';
import { ImpersonationView } from '@/features/platform-admin/impersonation';

export const metadata = { title: 'Plataforma — View-as' };

export default function PlatformImpersonationPage() {
  return (
    <Suspense fallback={null}>
      <ImpersonationView />
    </Suspense>
  );
}
