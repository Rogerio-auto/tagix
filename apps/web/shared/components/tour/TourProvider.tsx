'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useMarkTour, useTourState } from './queries';
import { TourSpotlight } from './TourSpotlight';
import type { TourContextValue, TourDefinition, TourStep } from './types';

const TourContext = createContext<TourContextValue | null>(null);

/** Resolve o nó-alvo de um passo. `null` se o passo não tem âncora ou ela sumiu. */
function resolveTarget(step: TourStep | undefined): HTMLElement | null {
  if (!step?.target || typeof document === 'undefined') return null;
  // `CSS.escape` evita injeção/quebra se o id tiver caracteres especiais.
  const selector = `[data-tour-id="${cssEscape(step.target)}"]`;
  return document.querySelector<HTMLElement>(selector);
}

/** `CSS.escape` com fallback defensivo (ambientes muito antigos / SSR). */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Decide se um passo é apresentável: passo sem âncora (intro/conclusão) sempre é;
 * passo ancorado só se o elemento existe na tela atual. O engine pula os ausentes.
 */
function isStepPresentable(step: TourStep | undefined): boolean {
  if (!step) return false;
  if (!step.target) return true;
  return resolveTarget(step) != null;
}

export interface TourProviderProps {
  /** Tours declarativos disponíveis no shell. */
  tours: TourDefinition[];
  /** Habilita a leitura do estado persistido (ex.: só após sessão hidratada). */
  enabled?: boolean;
  children?: ReactNode;
}

/**
 * Provider do engine de tour guiado (ONBOARDING.md §4.1). Mantém o tour ativo e o
 * passo corrente, expõe navegação por `useTour`, e renderiza o `TourSpotlight`.
 *
 * Resolução robusta de alvo: a navegação pula passos cujo `data-tour-id` não existe
 * na tela atual (ex.: âncora numa rota diferente) em vez de travar num recorte vazio.
 *
 * Persistência por membro: concluir/pular grava em `members.tour_state` via
 * `PUT /api/me/tour-state`; o engine não auto-reabre tours já vistos (`hasSeen`).
 *
 * NÃO mora em `@hm/ui` de propósito (gotcha do barrel client→server leak, F10): o
 * tour é client-only e vive em `apps/web/shared/components`.
 */
export function TourProvider({ tours, enabled = true, children }: TourProviderProps): ReactNode {
  const { data: tourState, isSuccess } = useTourState(enabled);
  const markTour = useMarkTour();

  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  // Índice estável das definições por id (registro declarativo).
  const tourById = useMemo(() => {
    const map = new Map<string, TourDefinition>();
    for (const t of tours) map.set(t.id, t);
    return map;
  }, [tours]);

  const activeTour = activeTourId ? (tourById.get(activeTourId) ?? null) : null;
  const steps = activeTour?.steps ?? [];

  // Evita re-disparar persistência do mesmo tour ao re-renderizar.
  const persistedRef = useRef<string | null>(null);

  const hasSeen = useCallback(
    (tourId: string): boolean => {
      const entry = tourState?.[tourId];
      return entry != null && (entry.completed_at != null || entry.dismissed === true);
    },
    [tourState],
  );

  const close = useCallback(() => {
    setActiveTourId(null);
    setActiveStepIndex(0);
  }, []);

  const persist = useCallback(
    (tourId: string, kind: 'completed' | 'dismissed') => {
      // Guard de idempotência por ciclo de "tour aberto".
      const stamp = `${tourId}:${kind}`;
      if (persistedRef.current === stamp) return;
      persistedRef.current = stamp;
      markTour.mutate(
        kind === 'completed' ? { tourId, completed: true } : { tourId, dismissed: true },
      );
    },
    [markTour],
  );

  /**
   * Encontra o próximo índice apresentável a partir de `from` (inclusivo) na
   * direção `dir`. Retorna -1 se não há nenhum (todos os passos restantes ausentes).
   */
  const findPresentable = useCallback(
    (list: TourStep[], from: number, dir: 1 | -1): number => {
      for (let i = from; i >= 0 && i < list.length; i += dir) {
        if (isStepPresentable(list[i])) return i;
      }
      return -1;
    },
    [],
  );

  const finish = useCallback(() => {
    if (activeTourId) persist(activeTourId, 'completed');
    close();
  }, [activeTourId, persist, close]);

  const skip = useCallback(() => {
    if (activeTourId) persist(activeTourId, 'dismissed');
    close();
  }, [activeTourId, persist, close]);

  const next = useCallback(() => {
    if (!activeTour) return;
    const list = activeTour.steps;
    const nextIdx = findPresentable(list, activeStepIndex + 1, 1);
    if (nextIdx === -1) {
      // Não há mais passo apresentável → conclui.
      persist(activeTour.id, 'completed');
      close();
      return;
    }
    setActiveStepIndex(nextIdx);
  }, [activeTour, activeStepIndex, findPresentable, persist, close]);

  const prev = useCallback(() => {
    if (!activeTour) return;
    const prevIdx = findPresentable(activeTour.steps, activeStepIndex - 1, -1);
    if (prevIdx === -1) return; // já no primeiro apresentável
    setActiveStepIndex(prevIdx);
  }, [activeTour, activeStepIndex, findPresentable]);

  const start = useCallback(
    (tourId: string, options?: { force?: boolean }): boolean => {
      const def = tourById.get(tourId);
      if (!def || def.steps.length === 0) return false;
      if (!options?.force && hasSeen(tourId)) return false;
      const firstIdx = findPresentable(def.steps, 0, 1);
      if (firstIdx === -1) return false; // nenhum passo visível na tela atual
      persistedRef.current = null;
      setActiveTourId(tourId);
      setActiveStepIndex(firstIdx);
      return true;
    },
    [tourById, hasSeen, findPresentable],
  );

  const activeStep = activeTour ? (activeTour.steps[activeStepIndex] ?? null) : null;

  const value = useMemo<TourContextValue>(
    () => ({
      activeTourId,
      activeStepIndex,
      activeStep,
      totalSteps: steps.length,
      start,
      next,
      prev,
      skip,
      finish,
      hasSeen,
      isStateReady: !enabled || isSuccess,
    }),
    [
      activeTourId,
      activeStepIndex,
      activeStep,
      steps.length,
      start,
      next,
      prev,
      skip,
      finish,
      hasSeen,
      enabled,
      isSuccess,
    ],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {activeStep && (
        <TourSpotlight
          step={activeStep}
          stepIndex={activeStepIndex}
          totalSteps={steps.length}
          onNext={next}
          onPrev={prev}
          onSkip={skip}
          onFinish={finish}
          resolveTarget={() => resolveTarget(activeStep)}
        />
      )}
    </TourContext.Provider>
  );
}

/** Acessa a API do engine de tour. Lança fora de um `TourProvider`. */
export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour deve ser usado dentro de um <TourProvider>.');
  return ctx;
}
