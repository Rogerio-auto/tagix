import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/shared/lib/supabase-server';
import { AppLayout } from '@/shared/components/layout/AppLayout';
import { ImpersonationBanner } from '@/shared/components/impersonation-banner';

/** Cookie de claim de view-as (espelha IMPERSONATION_COOKIE da API, F26-S05). */
const IMPERSONATION_COOKIE = 'hm_impersonation';

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/login');
  // View-as (F26-S09): quando ha claim de impersonation, monta o banner global
  // persistente (inescapavel) acima do app. Aditivo -- nao regride o app de workspace.
  const impersonating = Boolean((await cookies()).get(IMPERSONATION_COOKIE)?.value);
  return (
    <>
      {impersonating && <ImpersonationBanner />}
      <AppLayout>{children}</AppLayout>
    </>
  );
}
