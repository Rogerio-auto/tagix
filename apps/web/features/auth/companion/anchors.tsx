'use client';

import { createContext, useCallback, useContext } from 'react';
import type { ReactNode, RefCallback } from 'react';
import type { CompanionAnchorName } from './contract';

/**
 * Âncoras do companheiro (F76-S11): o motor mede elementos por ref, nunca por coordenada
 * fixa (SPEC §3). Cada posto tem a sua:
 * - `heading`: o `<header>` do `AuthHeading` (ref via `useCompanionAnchor('heading')`);
 * - `perch`: `<CompanionPerch/>`, faixa em fluxo no `BrandPanel` (F76-S14);
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
 * Posto `perch` (F76-S14): uma FAIXA REAL no fluxo do `BrandPanel`, entre o eyebrow e o bloco
 * editorial (`flex-1 min-h-14`, sem texto). O personagem fica dentro dela, então não existe
 * viewport em que ele possa sobrepor o texto do painel: a faixa é caixa de layout, não uma
 * coordenada. O motor lê o retângulo dela (nunca uma constante) e, se ela tiver menos de
 * 48 px de altura, o personagem fica no posto `heading`. O pai precisa ser `flex-col`.
 */
export function CompanionPerch(): ReactNode {
  const ref = useSlotRef<HTMLDivElement>('perch');
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-companion-anchor="perch"
      className="pointer-events-none hidden min-h-14 flex-1 lg:block"
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
