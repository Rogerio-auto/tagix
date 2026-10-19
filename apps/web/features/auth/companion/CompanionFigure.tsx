'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import './art/rig.css';
import './companion.css';
import { RigInline40 } from './art/rig-inline-40';
import { RigMd48 } from './art/rig-md-48';
import { RIG } from './art/rig';
import type { EyeSet, TipSignal } from './art/rig';
import { Bubble } from './Bubble';
import type {
  CompanionFigureProps,
  CompanionStation,
  MascotLook,
  MascotState,
} from './contract';
import type { AnchorRegistry } from './anchors';
import type { Director } from './director';
import {
  CROSSFADE_MS,
  CROSSFADE_SWAP_MS,
  CELEBRATE_HOLD_MS,
  blinkDelay,
  clamp,
  planBlink,
  planBreath,
  planCelebrate,
  planCrossfade,
  planEntrance,
  planFlight,
  planGlide,
  planProof,
  planThinking,
  planTipDip,
} from './flight';
import type { PlanTrack, Point } from './flight';

/**
 * Chunk lazy do companheiro (F76-S11): figura, voo, balão e estilos. Carregado por
 * `next/dynamic` (ssr:false) depois da hidratação, de um idle e de ≥ 400 ms do FCP, então
 * fica fora do caminho do LCP. O teste de peso do F76-S13 procura esta marca nos chunks
 * emitidos e exige que ela NÃO esteja nos scripts iniciais da rota.
 */
export const COMPANION_CHUNK_MARKER = 'leadium-auth-companion-chunk@1';

/* ------------------------------------------------------------------------- */
/* Baralho de animações: único dono de todas as animações WAAPI do personagem. */
/* ------------------------------------------------------------------------- */

function toKeyframes(track: PlanTrack): Keyframe[] {
  return track.keyframes.map((k): Keyframe => {
    const out: Keyframe = { offset: k.offset };
    if (k.transform !== undefined) out['transform'] = k.transform;
    if (k.translate !== undefined) out['translate'] = k.translate;
    if (k.opacity !== undefined) out['opacity'] = k.opacity;
    if (k.easing !== undefined) out['easing'] = k.easing;
    return out;
  });
}

/**
 * Registra toda animação criada, por grupo, para poder cancelar por grupo e PAUSAR TUDO
 * com a aba oculta ou o personagem fora da viewport. Sem rAF: só WAAPI (compositor).
 */
export class MotionDeck {
  private readonly live = new Map<Animation, string>();
  private halted = false;
  private readonly frozen = new Set<string>();

  play(
    el: Element | null | undefined,
    track: PlanTrack,
    group: string,
    fill: FillMode = 'none',
  ): Promise<void> {
    if (!el || typeof el.animate !== 'function') return Promise.resolve();
    const anim = el.animate(toKeyframes(track), {
      duration: track.duration,
      delay: track.delay ?? 0,
      iterations: track.iterations ?? 1,
      easing: track.easing ?? 'linear',
      fill,
    });
    this.live.set(anim, group);
    if (this.halted || this.frozen.has(group)) anim.pause();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        this.live.delete(anim);
        resolve();
      };
      anim.onfinish = done;
      anim.oncancel = done;
    });
  }

  cancel(group: string): void {
    for (const [anim, g] of [...this.live]) {
      if (g === group) anim.cancel();
    }
  }

  cancelAll(): void {
    for (const anim of [...this.live.keys()]) anim.cancel();
  }

  /** Aba oculta ou fora da viewport: tudo para. */
  setHalted(halted: boolean): void {
    this.halted = halted;
    this.refresh();
  }

  /** Congela só um grupo (a respiração com o teclado virtual aberto ou digitando). */
  setFrozen(group: string, frozen: boolean): void {
    if (frozen) this.frozen.add(group);
    else this.frozen.delete(group);
    this.refresh();
  }

  /** Quantas animações estão de fato rodando (teste de ociosidade). */
  get running(): number {
    let n = 0;
    for (const anim of this.live.keys()) if (anim.playState === 'running') n += 1;
    return n;
  }

  private refresh(): void {
    for (const [anim, group] of this.live) {
      const stop = this.halted || this.frozen.has(group);
      if (stop && anim.playState === 'running') anim.pause();
      else if (!stop && anim.playState === 'paused') anim.play();
    }
  }
}

function layer(root: Element | null, name: string): SVGElement | null {
  return root?.querySelector<SVGElement>(`[data-layer="${name}"]`) ?? null;
}

/* ------------------------------------------------------------------------- */
/* Figura (folha): estado → desenho + animações do próprio estado.            */
/* ------------------------------------------------------------------------- */

export interface CompanionFigureExtras {
  deck: MotionDeck;
  /** Entrada, voo e pouso em andamento: sem respiração nem piscar. */
  suspended?: boolean;
  /** Digitando ou teclado virtual aberto: congela a respiração. */
  frozen?: boolean;
  /** Muda quando o resultado chega com sucesso: a ponta faz a "prova" (SPEC §4.4). */
  proofRev?: number;
}

function eyesFor(state: MascotState, happy: boolean): EyeSet {
  if (state === 'avert') return 'closed';
  if (state === 'confused') return 'squint';
  if (state === 'celebrate' && happy) return 'happy';
  return 'open';
}

function tipFor(state: MascotState): TipSignal {
  if (state === 'thinking' || state === 'celebrate') return 'lit';
  if (state === 'confused') return 'warn';
  return 'off';
}

function lookFor(state: MascotState, look: MascotLook): MascotLook {
  if (state === 'avert') return 'right';
  if (state === 'thinking') return 'up';
  return look;
}

export function CompanionFigure({
  state,
  look,
  size,
  motion,
  autoBlink = true,
  onStateEnd,
  deck,
  suspended = false,
  frozen = false,
  proofRev = 0,
}: CompanionFigureProps & CompanionFigureExtras): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const lod = size === 48 ? 'md-48' : 'inline-40';
  const live = motion === 'live';
  const [happy, setHappy] = useState(false);

  const endRef = useRef(onStateEnd);
  endRef.current = onStateEnd;

  const eyes = eyesFor(state, happy || (motion === 'off' && state === 'celebrate'));
  const tip = tipFor(state);
  const effectiveLook = lookFor(state, look);

  // Estados com movimento próprio.
  useEffect(() => {
    const root = rootRef.current;
    let timers: Array<ReturnType<typeof setTimeout>> = [];
    const later = (fn: () => void, ms: number): void => {
      timers.push(setTimeout(fn, ms));
    };

    if (state === 'thinking' && live) {
      const base = RIG[lod].look.up;
      const plan = planThinking({ x: base[0], y: base[1] });
      void deck.play(layer(root, 'antenna-tip'), plan.tip, 'state');
      void deck.play(layer(root, 'antenna'), plan.antenna, 'state');
      void deck.play(layer(root, 'eyes'), plan.eyes, 'state');
    }

    if (state === 'celebrate') {
      if (live) {
        const plan = planCelebrate(lod);
        void deck.play(layer(root, 'fig'), plan.fig, 'state');
        void deck.play(layer(root, 'fig'), plan.figArc, 'state');
        if (plan.antenna) void deck.play(layer(root, 'antenna'), plan.antenna, 'state');
        void deck.play(layer(root, 'shadow'), plan.shadow, 'state');
        void deck.play(layer(root, 'halo'), plan.halo, 'state');
        later(() => setHappy(true), plan.happyAt);
        later(() => endRef.current?.('celebrate'), plan.duration + plan.holdMs);
      } else {
        setHappy(true);
        later(() => endRef.current?.('celebrate'), CELEBRATE_HOLD_MS);
      }
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      timers = [];
      deck.cancel('state');
      setHappy(false);
    };
  }, [state, live, lod, deck]);

  // Respiração (máx. 3 ciclos após cada pouso ou fim de estado) e piscar.
  useEffect(() => {
    if (!live || state !== 'idle' || suspended) return undefined;
    const root = rootRef.current;
    void deck.play(layer(root, 'fig'), planBreath(), 'breath');

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (): void => {
      timer = setTimeout(() => {
        void deck.play(layer(root, 'eyes-open'), planBlink(), 'blink');
        schedule();
      }, blinkDelay(Math.random()));
    };
    if (autoBlink) schedule();

    return () => {
      if (timer !== null) clearTimeout(timer);
      deck.cancel('breath');
      deck.cancel('blink');
    };
  }, [live, state, suspended, autoBlink, deck]);

  useEffect(() => {
    deck.setFrozen('breath', frozen);
  }, [frozen, deck]);

  // A ponta pisca de leve ao trocar de cor (crossfade só com opacity).
  const lastTip = useRef<TipSignal>(tip);
  useEffect(() => {
    if (lastTip.current === tip) return;
    lastTip.current = tip;
    if (live) void deck.play(layer(rootRef.current, 'antenna-tip'), planTipDip(), 'tip');
  }, [tip, live, deck]);

  // "Prova" do sucesso: a ponta acende de .4 a 1 e cresce 1 → 1,25 em 200 ms.
  const lastProof = useRef(proofRev);
  useEffect(() => {
    if (lastProof.current === proofRev) return;
    lastProof.current = proofRev;
    if (live) void deck.play(layer(rootRef.current, 'antenna-tip'), planProof(), 'tip');
  }, [proofRev, live, deck]);

  const art = { eyes, tip, look: effectiveLook } as const;
  return (
    <div
      ref={rootRef}
      data-companion=""
      data-companion-chunk={COMPANION_CHUNK_MARKER}
      data-state={state}
      data-look={effectiveLook}
      data-motion={motion}
      data-size={size}
      className="m-figure"
    >
      {size === 48 ? <RigMd48 {...art} /> : <RigInline40 {...art} />}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Ator: posto, medição, voo, deslize, crossfade, pausa e balão.              */
/* ------------------------------------------------------------------------- */

export interface CompanionActorProps {
  director: Director;
  anchors: AnchorRegistry;
  stageRef: RefObject<HTMLElement | null>;
  desktop: boolean;
  reducedMotion: boolean;
}

/** Aba visível E personagem dentro da viewport (IntersectionObserver). */
function usePageActive(target: RefObject<Element | null>): boolean {
  const [pageVisible, setPageVisible] = useState(true);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const onVisibility = (): void => setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const el = target.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setInView(last.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  return pageVisible && inView;
}

const HEIGHT_TO_SHADOW_48 = 45.5;
const HEADING_INSET = 24;
const PERCH_X = 72;
const PERCH_MARGIN = 96;

function measure(
  stage: HTMLElement,
  station: CompanionStation,
  size: number,
  anchors: AnchorRegistry,
  focus: Element | null,
): Point | null {
  const s = stage.getBoundingClientRect();
  if (station === 'inline') {
    const el = anchors.get('inline');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left - s.left, y: r.top - s.top };
  }
  if (station === 'heading') {
    const header = anchors.get('heading');
    if (!header) return null;
    const hr = header.getBoundingClientRect();
    const eyebrow = header.firstElementChild ?? header;
    const er = eyebrow.getBoundingClientRect();
    return {
      x: hr.right - HEADING_INSET - size / 2 - s.left,
      y: er.bottom - HEIGHT_TO_SHADOW_48 - s.top,
    };
  }
  const panel = anchors.get('perch');
  if (!panel) return null;
  const pr = panel.getBoundingClientRect();
  if (pr.width === 0 && pr.height === 0) return null;
  const fr = focus?.getBoundingClientRect();
  const fieldCy = fr ? fr.top + fr.height / 2 : pr.top + pr.height / 2;
  const lo = pr.top + PERCH_MARGIN;
  const hi = pr.bottom - PERCH_MARGIN;
  const cy = hi < lo ? pr.top + pr.height / 2 : clamp(lo, fieldCy, hi);
  return { x: pr.left + PERCH_X - size / 2 - s.left, y: cy - size / 2 - s.top };
}

interface Placed {
  station: CompanionStation;
  x: number;
  y: number;
}

const place = (p: Point): string => `translate(${p.x}px, ${p.y}px)`;

export function CompanionActor({
  director,
  anchors,
  stageRef,
  desktop,
  reducedMotion,
}: CompanionActorProps): ReactNode {
  const snap = useSyncExternalStore(director.subscribe, director.getSnapshot, director.getSnapshot);
  const size = desktop ? 48 : 40;
  const lod = desktop ? 'md-48' : 'inline-40';
  const motion = reducedMotion ? 'off' : 'live';

  const posRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const fyRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<HTMLDivElement>(null);
  const figRootRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<MotionDeck | null>(null);
  if (deckRef.current === null) deckRef.current = new MotionDeck();
  const deck = deckRef.current;

  const placedRef = useRef<Placed | null>(null);
  const lastFocusRev = useRef(snap.focusRev);
  const flying = useRef(false);
  const [placed, setPlaced] = useState(false);
  const [busy, setBusy] = useState(true);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const active = usePageActive(enterRef);
  useEffect(() => {
    deck.setHalted(!active);
  }, [active, deck]);

  useEffect(() => {
    director.setFigureReady(true);
    return () => {
      deck.cancelAll();
      director.setFigureReady(false);
    };
  }, [director, deck]);

  // Remedição: ResizeObserver (palco e âncoras), fontes e troca de etapa (registry).
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(bump);
    const observeAll = (): void => {
      if (!ro) return;
      ro.disconnect();
      if (stageRef.current) ro.observe(stageRef.current);
      for (const slot of ['heading', 'perch', 'inline'] as const) {
        const el = anchors.get(slot);
        if (el) ro.observe(el);
      }
    };
    observeAll();
    const unsub = anchors.subscribe(() => {
      observeAll();
      bump();
    });
    void document.fonts?.ready.then(bump);
    return () => {
      unsub();
      ro?.disconnect();
    };
  }, [anchors, stageRef, bump]);

  const station = snap.station;
  const focusRev = snap.focusRev;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pos = posRef.current;
    if (!stage || !pos) return;
    const next = measure(stage, station, size, anchors, director.getFocusTarget());
    if (next === null) {
      setPlaced(false);
      return;
    }
    const prev = placedRef.current;
    const focusChanged = lastFocusRev.current !== focusRev;
    lastFocusRev.current = focusRev;

    if (flying.current) return; // reposiciona quando o voo atual terminar (tick)

    const commitPos = (): void => {
      pos.style.transform = place(next);
      placedRef.current = { station, x: next.x, y: next.y };
    };

    if (prev === null) {
      commitPos();
      setPlaced(true);
      const track: PlanTrack = reducedMotion
        ? {
            duration: CROSSFADE_MS,
            easing: 'linear',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 },
            ],
          }
        : planEntrance();
      void deck
        .play(enterRef.current, track, 'enter')
        .then(() => {
          setBusy(false);
          director.entered();
        });
      return;
    }

    const stationChanged = prev.station !== station;
    const moved = Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5;
    if (!stationChanged && !moved) return;

    const flyable = stationChanged && station !== 'inline' && prev.station !== 'inline';

    if (flyable && reducedMotion) {
      flying.current = true;
      setBusy(true);
      void deck.play(pos, planCrossfade(), 'move');
      setTimeout(() => {
        commitPos();
      }, CROSSFADE_SWAP_MS);
      setTimeout(() => {
        flying.current = false;
        setBusy(false);
        director.landed();
        bump();
      }, CROSSFADE_MS);
      return;
    }

    if (flyable) {
      flying.current = true;
      setBusy(true);
      const from: Point = { x: prev.x, y: prev.y };
      const plan = planFlight(from, next);
      commitPos();
      const fig = layer(figRootRef.current, 'fig');
      const antenna = layer(figRootRef.current, 'antenna');
      const shadow = layer(figRootRef.current, 'shadow');
      pos.style.willChange = 'transform';
      const travel = Promise.all([
        deck.play(fxRef.current, plan.x, 'flight', 'forwards'),
        deck.play(fyRef.current, plan.y, 'flight', 'forwards'),
        deck.play(fig, plan.figArc, 'flight', 'forwards'),
        deck.play(fig, plan.fig, 'flight', 'forwards'),
        deck.play(antenna, plan.antenna, 'flight', 'forwards'),
        deck.play(shadow, plan.shadow, 'flight', 'forwards'),
      ]);
      void travel.then(async () => {
        const settle = [
          deck.play(fig, plan.land.fig, 'land'),
          deck.play(antenna, plan.land.antenna, 'land'),
        ];
        deck.cancel('flight');
        pos.style.willChange = '';
        await Promise.all(settle);
        flying.current = false;
        setBusy(false);
        director.landed();
        bump();
      });
      return;
    }

    // Deslize do `perch` até o novo campo (sem arco) ou reposição instantânea.
    commitPos();
    if (station === 'perch' && focusChanged && moved && !reducedMotion) {
      void deck.play(fyRef.current, planGlide(prev.y - next.y), 'move');
    }
    director.landed();
  }, [station, focusRev, size, tick, reducedMotion, anchors, stageRef, director, deck, bump]);

  const frozen = snap.typing || snap.keyboardOpen;
  const onStateEnd = useCallback((s: MascotState) => director.stateEnded(s), [director]);

  return (
    <div
      ref={posRef}
      data-companion-actor=""
      data-placed={placed ? 'true' : 'false'}
      data-station={station}
      style={{ width: size, height: size }}
      className="m-pos"
    >
      <div ref={fxRef} className="m-layer">
        <div ref={fyRef} className="m-layer">
          <div ref={enterRef} className="m-enter" data-lod={lod}>
            <div ref={figRootRef} className="m-layer">
              <CompanionFigure
                state={snap.state}
                look={snap.look}
                size={size}
                motion={motion}
                onStateEnd={onStateEnd}
                deck={deck}
                suspended={busy}
                frozen={frozen}
                proofRev={snap.proofRev}
              />
            </div>
          </div>
        </div>
      </div>
      <Bubble
        text={station === 'perch' ? null : snap.bubble}
        seq={snap.bubbleSeq}
        placement={station === 'inline' ? 'below' : 'start'}
      />
    </div>
  );
}
