/**
 * Tipos do engine de tour guiado in-house (F43-S07 / ONBOARDING.md §4.1).
 *
 * Um tour é uma sequência declarativa de passos. Cada passo ancora num elemento da
 * tela via `data-tour-id` (resolvido por `[data-tour-id="..."]`). O engine não sabe
 * NADA sobre o conteúdo — quem registra o tour fornece textos e âncoras (F43-S08).
 */
import type { ReactNode } from 'react';

/** Lado em que o balão (popover) prefere aparecer relativo ao alvo. */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

/** Um passo declarativo do tour. */
export interface TourStep {
  /**
   * Valor do `data-tour-id` do elemento a destacar. Se nenhum elemento na tela
   * atual tiver esse atributo, o passo é pulado graciosamente (não trava o tour).
   * Omitir = passo "sem âncora" (balão centralizado, sem recorte) — útil para
   * intro/conclusão.
   */
  target?: string;
  /** Título curto do passo (string ou nó — ex.: ícone + texto). */
  title: ReactNode;
  /** Corpo explicativo ("aqui serve tal coisa, é assim que se usa"). */
  body: ReactNode;
  /** Lado preferido do balão. Default: `'bottom'`. Cai para o lado oposto se não couber. */
  placement?: TourPlacement;
}

/** Definição declarativa de um tour. */
export interface TourDefinition {
  /**
   * Identidade estável do tour — chave da persistência (`members.tour_state[id]`).
   * Não reusar entre conteúdos diferentes (mudar o id "reabre" o tour).
   */
  id: string;
  /** Passos na ordem de apresentação. */
  steps: TourStep[];
}

/** Estado persistido de um tour (espelha `members.tour_state[id]`). */
export interface TourEntry {
  completed_at?: string;
  dismissed?: boolean;
}

/** Mapa por tourId → estado, como vem de `GET /api/onboarding/state → tourState`. */
export type TourStateMap = Record<string, TourEntry>;

/** Body de `PUT /api/me/tour-state` (exige `completed` OU `dismissed`). */
export interface TourStateInput {
  tourId: string;
  completed?: boolean;
  dismissed?: boolean;
}

/** API pública do contexto de tour (consumida via `useTour`). */
export interface TourContextValue {
  /** Id do tour em execução, ou `null` se nenhum está ativo. */
  activeTourId: string | null;
  /** Índice do passo corrente (0-based) dentro do tour ativo. */
  activeStepIndex: number;
  /** O passo corrente já resolvido, ou `null` quando não há tour ativo. */
  activeStep: TourStep | null;
  /** Total de passos do tour ativo (0 quando inativo). */
  totalSteps: number;
  /**
   * Inicia um tour. Por padrão NÃO reabre tours já concluídos/dispensados
   * (`force: true` ignora a persistência — usado por "ver tour de novo").
   * Retorna `false` se não iniciou (já visto, sem passos visíveis ou desconhecido).
   */
  start: (tourId: string, options?: { force?: boolean }) => boolean;
  /** Avança um passo. No último, conclui (persiste `completed`). */
  next: () => void;
  /** Volta um passo (no-op no primeiro). */
  prev: () => void;
  /** Pula o tour: fecha e persiste `dismissed`. */
  skip: () => void;
  /** Encerra como concluído: fecha e persiste `completed`. */
  finish: () => void;
  /** `true` quando o tour já foi concluído ou dispensado por este membro. */
  hasSeen: (tourId: string) => boolean;
  /** Estado de carregamento da leitura do `tourState` (gating de auto-start). */
  isStateReady: boolean;
}
