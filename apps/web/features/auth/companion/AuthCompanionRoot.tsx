'use client';

import dynamic from 'next/dynamic';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnchorContext, createAnchorRegistry } from './anchors';
import type { AnchorRegistry } from './anchors';
import type { AuthCompanionApi, AuthCompanionRootProps, AuthStep } from './contract';
import { createDirector } from './director';
import type { Director } from './director';

/**
 * Provider + palco do companheiro (F76-S11). Esta é a ÚNICA parte do módulo no bundle
 * inicial da rota: director, máquina e âncoras (pequenos, sem DOM pesado). A figura, o
 * voo, o balão e o CSS vivem em `CompanionFigure.tsx`, que entra por `next/dynamic`
 * (ssr:false) depois da hidratação, de um idle e de ≥ 400 ms do FCP: fora do LCP.
 *
 * O palco é `absolute inset-0 pointer-events-none aria-hidden`: não participa do layout,
 * não recebe foco nem toque, e a pessoa nunca o encontra com leitor de tela.
 *
 * Só renderiza se `<html>` não tem `data-brand` ou se ele é `leadium` (ADR-006 §9).
 */

const LazyActor = dynamic(() => import('./CompanionFigure').then((m) => m.CompanionActor), {
  ssr: false,
});

interface CompanionContextValue {
  director: Director;
  anchors: AnchorRegistry;
}

export const CompanionContext = createContext<CompanionContextValue | null>(null);

const NOOP_API: AuthCompanionApi = Object.freeze({ signal: () => undefined });

/** Fora do provider: `signal` é no-op (a tela funciona igual sem o companheiro). */
export function useAuthCompanion(): AuthCompanionApi {
  const ctx = useContext(CompanionContext);
  return useMemo(
    () => (ctx === null ? NOOP_API : Object.freeze({ signal: ctx.director.signal })),
    [ctx],
  );
}

/** Anuncia a etapa atual (efeito). Fora do provider: nada. */
export function useAuthCompanionStep(step: AuthStep): void {
  const ctx = useContext(CompanionContext);
  useEffect(() => {
    ctx?.director.setStep(step);
  }, [ctx, step]);
}

/** O mínimo depois do FCP antes de carregar o chunk. */
export const FCP_GUARD_MS = 400;
export const IDLE_TIMEOUT_MS = 600;

/**
 * Espera hidratação (já estamos num efeito), `FCP + 400 ms` e um idle (timeout 600 ms).
 * Devolve o cancelamento.
 */
export function whenQuiet(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idle: number | null = null;
  let cancelled = false;

  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
  const wait =
    fcp === undefined ? FCP_GUARD_MS : Math.max(0, fcp + FCP_GUARD_MS - performance.now());

  const go = (): void => {
    if (!cancelled) run();
  };
  timer = setTimeout(() => {
    timer = null;
    if (typeof requestIdleCallback === 'function') {
      idle = requestIdleCallback(go, { timeout: IDLE_TIMEOUT_MS });
    } else {
      timer = setTimeout(go, 1);
    }
  }, wait);

  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    if (idle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
  };
}

/** `<html>` sem `data-brand` ou com `leadium`. */
export function isLeadiumBrand(): boolean {
  const brand = document.documentElement.dataset['brand'];
  return brand === undefined || brand === '' || brand === 'leadium';
}

/** Teclado virtual aberto: `visualViewport.height < .75 · innerHeight`. */
export function isKeyboardOpen(): boolean {
  const vv = window.visualViewport;
  return vv !== null && vv.height < 0.75 * window.innerHeight;
}

function subscribeMedia(query: string, onChange: (matches: boolean) => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(query);
  const handler = (): void => onChange(mq.matches);
  handler();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export interface AuthCompanionRootExtraProps {
  /** Classes do contêiner (precisa ser `relative` para o palco; já é por padrão). */
  className?: string;
}

export function AuthCompanionRoot({
  children,
  className,
}: AuthCompanionRootProps & AuthCompanionRootExtraProps): ReactNode {
  const [ctx] = useState<CompanionContextValue>(() => ({
    director: createDirector({ desktop: false }),
    anchors: createAnchorRegistry(),
  }));
  const { director, anchors } = ctx;
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // O diretor escuta só `focusin`/`focusout`/`pointerdown` na raiz.
  useEffect(() => {
    const root = rootRef.current;
    const detach = root ? director.attach(root) : undefined;
    return () => {
      detach?.();
      director.destroy();
    };
  }, [director]);

  useEffect(
    () =>
      subscribeMedia('(min-width: 1024px)', (matches) => {
        setDesktop(matches);
        director.setDesktop(matches);
      }),
    [director],
  );
  useEffect(() => subscribeMedia('(prefers-reduced-motion: reduce)', setReducedMotion), []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const check = (): void => director.setKeyboardOpen(isKeyboardOpen());
    check();
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, [director]);

  // Carrega o chunk só na marca Leadium, depois do FCP + 400 ms e de um idle.
  useEffect(() => {
    if (!isLeadiumBrand()) return undefined;
    return whenQuiet(() => setArmed(true));
  }, []);

  return (
    <CompanionContext.Provider value={ctx}>
      <AnchorContext.Provider value={anchors}>
        <div
          ref={rootRef}
          data-companion-root=""
          className={`relative ${className ?? 'flex min-h-dvh w-full'}`}
        >
          {children}
          <div
            ref={stageRef}
            aria-hidden="true"
            data-companion-stage=""
            className="pointer-events-none absolute inset-0"
          >
            {armed ? (
              <LazyActor
                director={director}
                anchors={anchors}
                stageRef={stageRef}
                desktop={desktop}
                reducedMotion={reducedMotion}
              />
            ) : null}
          </div>
        </div>
      </AnchorContext.Provider>
    </CompanionContext.Provider>
  );
}
