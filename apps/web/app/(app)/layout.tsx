import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/shared/lib/supabase-server';
import { AppLayout } from '@/shared/components/layout/AppLayout';
import { ImpersonationBanner } from '@/shared/components/impersonation-banner';
import { AppShellFrame } from '@/shared/components/account-banner';
import { WorkspaceSwitchHost } from '@/shared/components/workspace-switcher';
import { OnboardingProvider } from '@/features/onboarding';

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
      {/* Faixas de conta (F71-S08): só leitura > trial <= 3 dias > pagamento pendente >
          convite pendente, uma por vez, empilhadas depois do banner de view-as. A moldura
          mantém o shell em `h-dvh` (a faixa não empurra o rodapé para fora da tela). */}
      <AppShellFrame banners={impersonating ? <ImpersonationBanner /> : null}>
        {/* First-run (F43-S05): no primeiro acesso de um workspace ainda nao
            verticalizado, o provider abre o wizard de boas-vindas/nicho e monta o
            ponto do tour guiado. Client-only; nao regride o shell do app. */}
        <OnboardingProvider>
          <AppLayout>{children}</AppLayout>
        </OnboardingProvider>
      </AppShellFrame>
      {/* Atalhos Alt+Shift+N e cortina de transição da troca de empresa (F71-S08). */}
      <WorkspaceSwitchHost />
    </>
  );
}
