'use client';

import { createContext, useCallback, useContext } from 'react';
import type { ReactNode, RefCallback } from 'react';
import type { CompanionAnchorName } from './contract';

/**
 * Âncoras do companheiro (F76-S11): o motor mede elementos por ref, nunca por coordenada
 * fixa (SPEC §3). Cada posto tem a sua:
 * - `heading`: o `<header>` do `AuthHeading` (ref via `useCompanionAnchor('heading')`);
 * - `perch`: `<CompanionPerch/>` preenche o `BrandPanel` (que precisa ser `relative`);
 * - `inline`: `<CompanionInlineSlot/>` reserva a caixa 40×40 na linha do logotipo.
 *
 * Fora do provider tudo vira inerte: a tela funciona igual sem o companheiro.
 */

export type AnchorSlot = CompanionAnchorName | 'perch' | 'inline';

export interface AnchorRegistry {
  get(slot: AnchorSlot): HTMLElement | null;
  set(slot: AnchorSlot, el: HTMLElement): () => void;
  /** Avisa quando uma âncora entra, sai ou troca (nova etapa, novo header). */
  subscribe(listener: () => void): () => void;
}

export function createAnchorRegistry(): AnchorRegistry {
  const map = new Map<AnchorSlot, HTMLElement>();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const fn of [...listeners]) fn();
  };
  return {
    get: (slot) => map.get(slot) ?? null,
    set(slot, el) {
      map.set(slot, el);
      emit();
      return () => {
        // Só solta se ainda é a mesma: a etapa nova pode ter registrado antes do cleanup.
        if (map.get(slot) === el) {
          map.delete(slot);
          emit();
        }
      };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const AnchorContext = createContext<AnchorRegistry | null>(null);

function useSlotRef<T extends HTMLElement>(slot: AnchorSlot): RefCallback<T> {
  const registry = useContext(AnchorContext);
  return useCallback(
    (el: T | null) => {
      if (registry === null || el === null) return undefined;
      return registry.set(slot, el);
    },
    [registry, slot],
  );
}

/** Ref de âncora (ex.: o `<header>` do `AuthHeading`). Inerte fora do provider. */
export function useCompanionAnchor<T extends HTMLElement>(
  name: CompanionAnchorName,
): RefCallback<T> {
  return useSlotRef<T>(name);
}

/**
 * Âncora do posto `perch`. Preenche o `BrandPanel` (que deve ser `position: relative`);
 * posicionada em absoluto, não afeta layout nem CLS.
 */
export function CompanionPerch(): ReactNode {
  const ref = useSlotRef<HTMLSpanElement>('perch');
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-companion-anchor="perch"
      className="pointer-events-none absolute inset-0 hidden lg:block"
    />
  );
}

/**
 * Posto `inline` (< lg) na linha do logotipo: caixa de 40×40 reservada no SSR para a
 * figura entrar depois sem deslocar o layout. Vazia e `aria-hidden`; some no lg+.
 */
export function CompanionInlineSlot(): ReactNode {
  const ref = useSlotRef<HTMLSpanElement>('inline');
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-companion-slot="inline"
      className="block size-10 shrink-0 lg:hidden"
    />
  );
}
