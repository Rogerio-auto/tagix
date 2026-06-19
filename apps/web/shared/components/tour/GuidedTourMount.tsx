'use client';

import type { ReactNode } from 'react';
import { useAuthStore } from '@/shared/stores/auth.store';
import { TourProvider } from './TourProvider';
import type { TourDefinition } from './types';

/**
 * Ponto de montagem do tour guiado no shell do app (ONBOARDING.md §4 / F43-S07).
 *
 * Monta o `TourProvider` real (engine de spotlight/coachmark + persistência por
 * membro). O CONTEÚDO dos tours e as âncoras `data-tour-id` nas telas de feature
 * (dashboard/inbox/pipeline/agentes/flows) são da F43-S08 — aqui registramos apenas
 * um tour de EXEMPLO mínimo, que serve de teste do engine.
 *
 * O exemplo NÃO auto-inicia: o engine só abre via `useTour().start('example')`
 * (programático). Como ainda não há âncoras nas telas, seus passos ancorados são
 * pulados graciosamente; o passo de intro (sem âncora) sempre aparece. Quando a
 * F43-S08 adicionar os `data-tour-id` e os tours reais, troca-se `EXAMPLE_TOURS`
 * pelos tours de conteúdo e habilita-se o auto-start no primeiro acesso.
 */

const EXAMPLE_TOURS: TourDefinition[] = [
  {
    id: 'engine-example',
    steps: [
      {
        // Passo sem âncora: balão centralizado. Demonstra o engine sem depender de
        // nenhuma tela específica (as âncoras reais vêm na F43-S08).
        title: 'Tour guiado',
        body: 'Este é o engine de tour da Leadium. Use Próximo/Anterior, as setas do teclado, ou Esc para sair.',
        placement: 'bottom',
      },
      {
        // Passo ancorado de exemplo: se a tela atual tiver este `data-tour-id`, o
        // engine destaca o elemento; senão, pula este passo sem travar.
        target: 'app-sidebar',
        title: 'Navegação',
        body: 'Aqui ficam as áreas do produto. (Âncora de exemplo — o conteúdo real é da F43-S08.)',
        placement: 'right',
      },
    ],
  },
];

export function GuidedTourMount(): ReactNode {
  // Só consulta o estado de tour quando há sessão hidratada (evita 401 ruidoso e
  // chamada sem cookie). O provider lida com o membro sem `workspace.edit` (403)
  // tratando como "nenhum tour visto".
  const isAuthed = useAuthStore((s) => s.auth != null);

  return <TourProvider tours={EXAMPLE_TOURS} enabled={isAuthed} />;
}
