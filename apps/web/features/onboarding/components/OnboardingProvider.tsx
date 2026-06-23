'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { can } from '@hm/shared';
import { GuidedTourMount } from '@/shared/components/tour/GuidedTourMount';
import { useAuthStore } from '@/shared/stores/auth.store';
import { OnboardingWizard } from './OnboardingWizard';
import { useOnboardingState } from '../queries';

/**
 * Provider de first-run montado no shell do app (ONBOARDING.md §3.2). No primeiro
 * acesso de um workspace ainda não verticalizado (`onboarding.niche_key == null`),
 * abre o wizard de boas-vindas automaticamente. Ao aplicar o blueprint, fecha e não
 * reabre (o estado passa a ter `niche_key`). Também é o ponto de montagem do tour
 * guiado (F43-S07) via `GuidedTourMount` (hoje no-op).
 *
 * Gating: aplicar/ler o onboarding exige `workspace.edit` (ADMIN/OWNER) no servidor.
 * Para membros sem essa permissão nem consultamos o estado — falha fechado, sem
 * wizard e sem ruído de erro. Dispensar manualmente (Esc/backdrop) não reabre na
 * sessão atual.
 */
export function OnboardingProvider({ children }: { children: ReactNode }): ReactNode {
  const auth = useAuthStore((s) => s.auth);
  // Só admins/owners aplicam o blueprint — só eles veem o wizard.
  const canOnboard = auth != null && can(auth.role, 'workspace.edit');

  const [open, setOpen] = useState(false);
  // Trava de sessão: uma vez aplicado ou dispensado, não reabre neste ciclo de vida.
  const [resolved, setResolved] = useState(false);

  const { data } = useOnboardingState(canOnboard);
  // Acesso defensivo: este provider envolve o shell inteiro do app — nunca pode
  // assumir a forma da resposta (uma API legada/erro/proxy poderia devolver um
  // corpo sem `onboarding`). Optional chaining em cada nível evita derrubar o app.
  const onboarding = data?.onboarding ?? null;
  const nicheKey = onboarding?.niche_key ?? null;
  const initialSurvey = onboarding?.survey ?? null;

  // Abre o wizard só quando o estado confirma que o workspace nunca foi verticalizado
  // (precisa de um objeto `onboarding` real; se não veio, degrada sem wizard).
  useEffect(() => {
    if (!canOnboard || resolved) return;
    if (onboarding && nicheKey == null) setOpen(true);
  }, [canOnboard, resolved, onboarding, nicheKey]);

  function handleDismiss(): void {
    setOpen(false);
    setResolved(true);
  }

  function handleApplied(): void {
    setOpen(false);
    setResolved(true);
  }

  return (
    <>
      {children}
      {canOnboard && (
        <OnboardingWizard
          open={open}
          initialSurvey={initialSurvey}
          onDismiss={handleDismiss}
          onApplied={handleApplied}
        />
      )}
      {/* Ponto de montagem do tour guiado (F43-S07 preenche; hoje no-op). */}
      <GuidedTourMount />
    </>
  );
}
