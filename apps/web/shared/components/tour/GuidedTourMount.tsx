'use client';

import type { ReactNode } from 'react';

/**
 * Ponto de montagem do tour guiado no shell do app (ONBOARDING.md §4 / F43-S07).
 *
 * STUB intencional (no-op): existe para que o ponto de montagem já viva no shell
 * (renderizado pelo `OnboardingProvider`) antes do engine de tour existir. O
 * F43-S07 preenche este componente com o overlay de spotlight/coachmark, leitura
 * de `data-tour-id`, navegação por teclado e persistência de `tour_state` por
 * membro. Até lá, não renderiza nada.
 */
export function GuidedTourMount(): ReactNode {
  return null;
}
