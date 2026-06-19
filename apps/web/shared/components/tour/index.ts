/**
 * API pública do engine de tour guiado (F43-S07 / ONBOARDING.md §4.1).
 *
 * Client-only por natureza (portal, foco, eventos de janela). NÃO mora em `@hm/ui`
 * de propósito — o barrel server-safe não pode arrastar 'use client' (gotcha F10).
 * O conteúdo dos tours e as âncoras `data-tour-id` nas telas são F43-S08.
 */
export { TourProvider, useTour } from './TourProvider';
export { GuidedTourMount } from './GuidedTourMount';
export type {
  TourContextValue,
  TourDefinition,
  TourPlacement,
  TourStateInput,
  TourStateMap,
  TourStep,
} from './types';
