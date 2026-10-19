/**
 * Gerador de movimento do companheiro (F76-S11). PURO: só números e strings de keyframe,
 * nenhum acesso ao DOM. Valores finais da SPEC §4 (que vence o PLANO); os de pose
 * espelham `art/rig.json` (um teste confere).
 *
 * Só `transform`, `translate` (propriedade individual de transform) e `opacity`.
 * Em um mesmo elemento, `translate` carrega o deslocamento (arco, pulo, respiração) e
 * `transform` carrega inclinar/esmagar/esticar: duas animações em propriedades diferentes
 * se compõem sem se atropelar.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PlanKeyframe {
  readonly offset: number;
  readonly transform?: string;
  readonly translate?: string;
  readonly opacity?: number;
  readonly easing?: string;
}

export interface PlanTrack {
  readonly keyframes: readonly PlanKeyframe[];
  readonly duration: number;
  readonly iterations?: number;
  readonly delay?: number;
  readonly easing?: string;
}

export const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const EASE_SPRING = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const EASE_X = 'cubic-bezier(0.4, 0, 0.1, 1)';
export const EASE_BREATH = 'cubic-bezier(0.37, 0, 0.63, 1)';
const EASE_RISE = 'cubic-bezier(0.25, 0.6, 0.3, 1)';
const EASE_FALL = 'cubic-bezier(0.4, 0, 1, 1)';

/** Progresso (0–1) de um `cubic-bezier(x1,y1,x2,y2)` no tempo normalizado `t`. */
export function bezierProgress(
  curve: readonly [number, number, number, number],
  t: number,
): number {
  const [x1, y1, x2, y2] = curve;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const axis = (a: number, b: number, s: number): number =>
    3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 40; i += 1) {
    s = (lo + hi) / 2;
    if (axis(x1, x2, s) < t) lo = s;
    else hi = s;
  }
  return axis(y1, y2, s);
}

export function clamp(min: number, v: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** d = clamp(560, 420 + dist · 0,45, 760) ms. */
export function flightDuration(dist: number): number {
  return clamp(560, 420 + dist * 0.45, 760);
}

/** Altura extra do ápice acima do ponto mais alto: clamp(24, dist · 0,12, 56) px. */
export function apexLift(dist: number): number {
  return clamp(24, dist * 0.12, 56);
}

export const ANTICIPATE_MS = 80;
/** Posição do ápice no tempo normalizado do voo. */
export const APEX_OFFSET = 0.45;
const STRETCH_OFFSET = 0.3;
export const SQUASH_HOLD_MS = 120;
export const SQUASH_RECOVER_MS = 220;
export const ANTENNA_SETTLE_MS = 360;

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;
const rest = 'rotate(0deg) scale(1, 1)';

export interface FlightPlan {
  readonly duration: number;
  readonly dist: number;
  readonly dir: 1 | -1;
  /** Apex do centro do corpo (relativo ao destino): menor y − `apexLift`. */
  readonly apexY: number;
  /** Elevação do arco sobre a trajetória do chão no ápice (px, positiva). */
  readonly hump: number;
  /** Envoltório X: do ponto de partida (deslocado) até 0. */
  readonly x: PlanTrack;
  /** Envoltório Y do chão (a sombra viaja aqui, sem arco). */
  readonly y: PlanTrack;
  /** `fig`: arco (propriedade `translate`). */
  readonly figArc: PlanTrack;
  /** `fig`: antecipar, esticar, ápice e chegada já amassando. */
  readonly fig: PlanTrack;
  readonly antenna: PlanTrack;
  readonly shadow: PlanTrack;
  /** Fase de pouso, depois de `duration`. */
  readonly land: {
    readonly fig: PlanTrack;
    readonly antenna: PlanTrack;
    readonly duration: number;
  };
}

/**
 * Voo de `from` a `to` (cantos superiores da caixa da figura, em px do palco).
 * `from`/`to` são os centros do deslocamento; a caixa viaja inteira.
 */
export function planFlight(from: Point, to: Point): FlightPlan {
  const dist = distance(from, to);
  const duration = flightDuration(dist);
  const a = ANTICIPATE_MS / duration;
  const dir: 1 | -1 = to.x < from.x ? -1 : 1;
  const dx0 = from.x - to.x;
  const dy0 = from.y - to.y;
  const lift = apexLift(dist);

  // Trajetória do chão: Y em --ease depois da antecipação. O arco é a diferença entre o
  // ápice pedido (menor y − lift) e onde o chão estaria nesse instante.
  const g = bezierProgress(
    [0.2, 0.8, 0.2, 1],
    (APEX_OFFSET - a) / (1 - a),
  );
  const groundAtApex = dy0 * (1 - g);
  const apexY = Math.min(dy0, 0) - lift;
  const hump = groundAtApex - apexY;

  const x: PlanTrack = {
    duration,
    keyframes: [
      { offset: 0, transform: `translateX(${px(dx0)})` },
      { offset: a, transform: `translateX(${px(dx0)})`, easing: EASE_X },
      { offset: 1, transform: 'translateX(0px)' },
    ],
  };
  const y: PlanTrack = {
    duration,
    keyframes: [
      { offset: 0, transform: `translateY(${px(dy0)})` },
      { offset: a, transform: `translateY(${px(dy0)})`, easing: EASE },
      { offset: 1, transform: 'translateY(0px)' },
    ],
  };
  const figArc: PlanTrack = {
    duration,
    keyframes: [
      { offset: 0, translate: '0 0px' },
      { offset: a, translate: '0 0px', easing: EASE_RISE },
      { offset: APEX_OFFSET, translate: `0 ${px(-hump)}`, easing: EASE },
      { offset: 1, translate: '0 0px' },
    ],
  };
  const fig: PlanTrack = {
    duration,
    keyframes: [
      { offset: 0, transform: rest },
      { offset: a, transform: 'rotate(0deg) scale(1.06, 0.92)', easing: EASE },
      { offset: STRETCH_OFFSET, transform: `rotate(${dir * 7}deg) scale(0.96, 1.05)`, easing: EASE },
      { offset: APEX_OFFSET, transform: `rotate(${dir * 4}deg) scale(0.97, 1.04)`, easing: EASE },
      { offset: 1, transform: 'rotate(0deg) scale(1.06, 0.93)' },
    ],
  };
  const antenna: PlanTrack = {
    duration,
    keyframes: [
      { offset: 0, transform: 'rotate(0deg)' },
      { offset: a, transform: 'rotate(0deg)', easing: EASE },
      { offset: STRETCH_OFFSET, transform: `rotate(${dir * -10}deg)`, easing: EASE },
      { offset: 1, transform: `rotate(${dir * 6}deg)` },
    ],
  };
  const shadow: PlanTrack = {
    duration,
    keyframes: [
      { offset: 0, transform: 'scale(1)', opacity: 1 },
      { offset: a, transform: 'scale(1)', opacity: 1, easing: EASE },
      { offset: APEX_OFFSET, transform: 'scale(0.6)', opacity: 0.4, easing: EASE },
      { offset: 1, transform: 'scale(1)', opacity: 1 },
    ],
  };

  const landTotal = SQUASH_HOLD_MS + SQUASH_RECOVER_MS;
  return {
    duration,
    dist,
    dir,
    apexY,
    hump,
    x,
    y,
    figArc,
    fig,
    antenna,
    shadow,
    land: {
      duration: landTotal,
      fig: {
        duration: landTotal,
        keyframes: [
          { offset: 0, transform: 'rotate(0deg) scale(1.06, 0.93)' },
          { offset: SQUASH_HOLD_MS / landTotal, transform: 'rotate(0deg) scale(1.06, 0.93)', easing: EASE_SPRING },
          { offset: 1, transform: rest },
        ],
      },
      antenna: {
        duration: ANTENNA_SETTLE_MS,
        keyframes: [
          { offset: 0, transform: `rotate(${dir * 6}deg)`, easing: EASE_SPRING },
          { offset: 1, transform: 'rotate(0deg)' },
        ],
      },
    },
  };
}

/** Deslize do `perch` até o novo campo: só Y, sem arco, 320 ms --ease. */
export function planGlide(dy: number): PlanTrack {
  return {
    duration: 320,
    easing: EASE,
    keyframes: [
      { offset: 0, transform: `translateY(${px(dy)})` },
      { offset: 1, transform: 'translateY(0px)' },
    ],
  };
}

/** Entrada: 320 ms --ease-spring. */
export function planEntrance(): PlanTrack {
  return {
    duration: 320,
    easing: EASE_SPRING,
    keyframes: [
      { offset: 0, opacity: 0, transform: 'translateY(-8px) scale(0.92)' },
      { offset: 1, opacity: 1, transform: 'translateY(0px) scale(1)' },
    ],
  };
}

/** Respiração: 0 → −1,5 → 0 px em 4,2 s, no máximo 3 ciclos. */
export const BREATH_CYCLES = 3;
export function planBreath(): PlanTrack {
  return {
    duration: 4200,
    iterations: BREATH_CYCLES,
    easing: EASE_BREATH,
    keyframes: [
      { offset: 0, translate: '0 0px' },
      { offset: 0.5, translate: '0 -1.5px' },
      { offset: 1, translate: '0 0px' },
    ],
  };
}

/** Piscar: escala Y de `eyes-open` 1 → .12 → 1 em 140 ms. */
export function planBlink(): PlanTrack {
  return {
    duration: 140,
    easing: EASE,
    keyframes: [
      { offset: 0, transform: 'scaleY(1)' },
      { offset: 0.5, transform: 'scaleY(0.12)' },
      { offset: 1, transform: 'scaleY(1)' },
    ],
  };
}

/** Intervalo aleatório do piscar: 4–9 s. `r` ∈ [0,1). */
export function blinkDelay(r: number): number {
  return 4000 + clamp(0, r, 1) * 5000;
}

/** Crossfade do movimento reduzido: 160 ms (a troca de posto acontece na metade). */
export const CROSSFADE_MS = 160;
export function planCrossfade(): PlanTrack {
  return {
    duration: CROSSFADE_MS,
    easing: 'linear',
    keyframes: [
      { offset: 0, opacity: 1 },
      { offset: 0.5, opacity: 0 },
      { offset: 1, opacity: 1 },
    ],
  };
}

/** Tempo até a troca de posto no crossfade. */
export const CROSSFADE_SWAP_MS = CROSSFADE_MS / 2;

export interface CelebratePlan {
  readonly duration: number;
  readonly fig: PlanTrack;
  readonly figArc: PlanTrack;
  readonly antenna: PlanTrack | null;
  readonly shadow: PlanTrack;
  readonly halo: PlanTrack;
  /** Instante (ms) em que os olhos viram felizes (fim do agachar). */
  readonly happyAt: number;
  /** Tempo extra com olhos felizes depois dos 900 ms. */
  readonly holdMs: number;
}

export const CELEBRATE_MS = 900;
export const CELEBRATE_HOLD_MS = 1200;

/**
 * Celebração (SPEC §4.1): 0–100 agacha (1,04 × .92) → 100–360 pulo (−6 px; −5 no LOD 40)
 * → 360–620 pouso 1,05 × .95 e mola. Halo r .6 → 1,4, opacity .5 → 0, 480 ms a partir
 * de 120 ms. Sombra no pico: scale .7, opacity .55.
 */
export function planCelebrate(lod: 'md-48' | 'inline-40'): CelebratePlan {
  const D = CELEBRATE_MS;
  const jump = lod === 'md-48' ? 6 : 5;
  const o = (ms: number): number => ms / D;
  return {
    duration: D,
    happyAt: 100,
    holdMs: CELEBRATE_HOLD_MS,
    fig: {
      duration: D,
      keyframes: [
        { offset: 0, transform: 'scale(1, 1)', easing: EASE },
        { offset: o(100), transform: 'scale(1.04, 0.92)', easing: EASE },
        { offset: o(230), transform: 'scale(0.98, 1.04)', easing: EASE },
        { offset: o(360), transform: 'scale(1.05, 0.95)', easing: EASE_SPRING },
        { offset: o(620), transform: 'scale(1, 1)' },
        { offset: 1, transform: 'scale(1, 1)' },
      ],
    },
    figArc: {
      duration: D,
      keyframes: [
        { offset: 0, translate: '0 0px' },
        { offset: o(100), translate: '0 0px', easing: EASE_SPRING },
        { offset: o(230), translate: `0 ${px(-jump)}`, easing: EASE_FALL },
        { offset: o(360), translate: '0 0px' },
        { offset: 1, translate: '0 0px' },
      ],
    },
    antenna:
      lod === 'md-48'
        ? {
            duration: D,
            keyframes: [
              { offset: 0, transform: 'rotate(0deg)', easing: EASE },
              { offset: o(100), transform: 'rotate(-3deg)', easing: EASE },
              { offset: o(230), transform: 'rotate(4deg)', easing: EASE },
              { offset: o(360), transform: 'rotate(-5deg)', easing: EASE_SPRING },
              { offset: o(620), transform: 'rotate(0deg)' },
              { offset: 1, transform: 'rotate(0deg)' },
            ],
          }
        : null,
    shadow: {
      duration: D,
      keyframes: [
        { offset: 0, transform: 'scale(1)', opacity: 1 },
        { offset: o(100), transform: 'scale(1)', opacity: 1, easing: EASE },
        { offset: o(230), transform: 'scale(0.7)', opacity: 0.55, easing: EASE },
        { offset: o(360), transform: 'scale(1)', opacity: 1 },
        { offset: 1, transform: 'scale(1)', opacity: 1 },
      ],
    },
    halo: {
      duration: 480,
      delay: 120,
      easing: EASE,
      keyframes: [
        { offset: 0, transform: 'scale(0.6)', opacity: 0.5 },
        { offset: 1, transform: 'scale(1.4)', opacity: 0 },
      ],
    },
  };
}

/** `thinking`: 1,6 s linear em loop. O olhar varre ±1,5 px em torno do deslocamento base. */
export function planThinking(lookBase: Point): {
  readonly tip: PlanTrack;
  readonly antenna: PlanTrack;
  readonly eyes: PlanTrack;
} {
  const sweep = (dx: number): string => `translate(${px(lookBase.x + dx)}, ${px(lookBase.y)})`;
  return {
    tip: {
      duration: 1600,
      iterations: Number.POSITIVE_INFINITY,
      easing: 'linear',
      keyframes: [
        { offset: 0, transform: 'scale(1)' },
        { offset: 0.5, transform: 'scale(1.15)' },
        { offset: 1, transform: 'scale(1)' },
      ],
    },
    antenna: {
      duration: 1600,
      iterations: Number.POSITIVE_INFINITY,
      easing: 'linear',
      keyframes: [
        { offset: 0, transform: 'rotate(0deg)' },
        { offset: 0.25, transform: 'rotate(4deg)' },
        { offset: 0.5, transform: 'rotate(0deg)' },
        { offset: 0.75, transform: 'rotate(-4deg)' },
        { offset: 1, transform: 'rotate(0deg)' },
      ],
    },
    eyes: {
      duration: 1600,
      iterations: Number.POSITIVE_INFINITY,
      easing: 'linear',
      keyframes: [
        { offset: 0, transform: sweep(-1.5) },
        { offset: 0.5, transform: sweep(1.5) },
        { offset: 1, transform: sweep(-1.5) },
      ],
    },
  };
}

/** Piscada da ponta ao trocar de cor (substitui o crossfade de `fill`, que não é transform/opacity). */
export function planTipDip(): PlanTrack {
  return {
    duration: 160,
    easing: EASE,
    keyframes: [
      { offset: 0, opacity: 0.35 },
      { offset: 1, opacity: 1 },
    ],
  };
}

/** "Prova" do sucesso: ponta de .4 a 1 e escala 1 → 1,25 em 200 ms (SPEC §4.4). */
export function planProof(): PlanTrack {
  return {
    duration: 200,
    easing: EASE,
    keyframes: [
      { offset: 0, opacity: 0.4, transform: 'scale(1)' },
      { offset: 1, opacity: 1, transform: 'scale(1.25)' },
    ],
  };
}
