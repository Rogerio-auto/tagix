import type { CSSProperties } from 'react';
import type { MascotLook } from '../contract';
import rigJson from './rig.json';

/**
 * Leitura tipada do `rig.json` (fonte única de camadas, pivôs, olhar e poses).
 *
 * O JSON é o contrato com a arte; aqui ele é validado UMA vez, na carga do módulo, por
 * guardas estreitas (sem cast cego e sem dependência). Um JSON inválido quebra cedo, no
 * teste e no build, em vez de desenhar um robô torto em produção.
 */

export type RigLod = 'md-48' | 'inline-40';
export type EyeSet = 'open' | 'closed' | 'happy' | 'squint';
export type TipSignal = 'off' | 'lit' | 'warn';
export type RigLayer =
  | 'shadow'
  | 'fig'
  | 'halo'
  | 'arm-l'
  | 'arm-r'
  | 'hand-r'
  | 'body'
  | 'head'
  | 'antenna'
  | 'antenna-tip'
  | 'visor'
  | 'eyes'
  | 'eyes-open';
export type RigPoseName =
  | 'rest'
  | 'blink'
  | 'avert'
  | 'thinking'
  | 'confused'
  | 'crouch'
  | 'jump'
  | 'land'
  | 'success'
  | 'anticipate'
  | 'stretch'
  | 'apex'
  | 'squash';

export interface PoseLayer {
  readonly transform?: string;
  readonly opacity?: number;
}

export interface RigPose {
  readonly eyes?: EyeSet;
  readonly tip?: TipSignal;
  readonly look?: MascotLook;
  readonly layers: Readonly<Partial<Record<RigLayer, PoseLayer>>>;
}

export type Point = readonly [number, number];

export interface RigLodSpec {
  readonly size: number;
  readonly viewBox: string;
  readonly pivots: Readonly<Record<RigLayer, Point>>;
  readonly look: Readonly<Record<MascotLook, Point>>;
  readonly poses: Readonly<Partial<Record<RigPoseName, RigPose>>>;
}

const LAYERS: readonly RigLayer[] = [
  'shadow',
  'fig',
  'halo',
  'arm-l',
  'arm-r',
  'hand-r',
  'body',
  'head',
  'antenna',
  'antenna-tip',
  'visor',
  'eyes',
  'eyes-open',
];
const POSES: readonly RigPoseName[] = [
  'rest',
  'blink',
  'avert',
  'thinking',
  'confused',
  'crouch',
  'jump',
  'land',
  'success',
  'anticipate',
  'stretch',
  'apex',
  'squash',
];
const EYES: readonly EyeSet[] = ['open', 'closed', 'happy', 'squint'];
const TIPS: readonly TipSignal[] = ['off', 'lit', 'warn'];
const LOOKS: readonly MascotLook[] = ['none', 'up', 'left', 'right'];

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(path: string): never {
  throw new Error(`[auth-companion] rig.json inválido em ${path}`);
}

function point(v: unknown, path: string): Point {
  if (!Array.isArray(v) || v.length !== 2) fail(path);
  const [x, y] = v as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number') fail(path);
  return [x, y];
}

function poseLayer(v: unknown, path: string): PoseLayer {
  if (!isRecord(v)) fail(path);
  const { transform, opacity } = v;
  if (transform !== undefined && typeof transform !== 'string') fail(`${path}.transform`);
  if (opacity !== undefined && (typeof opacity !== 'number' || opacity < 0 || opacity > 1)) {
    fail(`${path}.opacity`);
  }
  return {
    ...(transform !== undefined && { transform }),
    ...(opacity !== undefined && { opacity }),
  };
}

function pose(v: unknown, path: string): RigPose {
  if (!isRecord(v)) fail(path);
  const { eyes, tip, look, layers } = v;
  if (eyes !== undefined && !oneOf(EYES, eyes)) fail(`${path}.eyes`);
  if (tip !== undefined && !oneOf(TIPS, tip)) fail(`${path}.tip`);
  if (look !== undefined && !oneOf(LOOKS, look)) fail(`${path}.look`);
  const out: Partial<Record<RigLayer, PoseLayer>> = {};
  if (layers !== undefined) {
    if (!isRecord(layers)) fail(`${path}.layers`);
    for (const [name, value] of Object.entries(layers)) {
      if (!oneOf(LAYERS, name)) fail(`${path}.layers.${name}`);
      out[name] = poseLayer(value, `${path}.layers.${name}`);
    }
  }
  return {
    ...(eyes !== undefined && { eyes }),
    ...(tip !== undefined && { tip }),
    ...(look !== undefined && { look }),
    layers: out,
  };
}

function lodSpec(v: unknown, path: string): RigLodSpec {
  if (!isRecord(v)) fail(path);
  const { size, viewBox, pivots, look, poses } = v;
  if (typeof size !== 'number') fail(`${path}.size`);
  if (typeof viewBox !== 'string') fail(`${path}.viewBox`);
  if (!isRecord(pivots) || !isRecord(look) || !isRecord(poses)) fail(path);

  const pv = {} as Record<RigLayer, Point>;
  for (const layer of LAYERS) pv[layer] = point(pivots[layer], `${path}.pivots.${layer}`);

  const lk = {} as Record<MascotLook, Point>;
  for (const l of LOOKS) lk[l] = point(look[l], `${path}.look.${l}`);

  const ps: Partial<Record<RigPoseName, RigPose>> = {};
  for (const [name, value] of Object.entries(poses)) {
    if (!oneOf(POSES, name)) fail(`${path}.poses.${name}`);
    ps[name] = pose(value, `${path}.poses.${name}`);
  }
  return { size, viewBox, pivots: pv, look: lk, poses: ps };
}

function load(): Readonly<Record<RigLod, RigLodSpec>> {
  const lods: unknown = rigJson.lods;
  if (!isRecord(lods)) fail('lods');
  return {
    'md-48': lodSpec(lods['md-48'], 'md-48'),
    'inline-40': lodSpec(lods['inline-40'], 'inline-40'),
  };
}

/** Rig validado. Imutável por convenção (readonly nos tipos). */
export const RIG: Readonly<Record<RigLod, RigLodSpec>> = load();

/** Espessura única do traço (px no tamanho nativo do LOD). */
export const RIG_STROKE = 1.5;

export interface RigArtProps {
  /** Conjunto de olhos visível. Sobrepõe o da pose. */
  eyes?: EyeSet;
  /** Estado da ponta da antena. Sobrepõe o da pose. */
  tip?: TipSignal;
  /** Para onde os olhos apontam. Sobrepõe o da pose. */
  look?: MascotLook;
  /**
   * Quadro-pose aplicado em estilo inline (folha de poses, movimento reduzido). Com o
   * motor vivo, o F76-S11 omite e anima por WAAPI usando os mesmos valores do `rig.json`.
   */
  pose?: RigPoseName;
  className?: string;
}

export interface ResolvedRig {
  readonly eyes: EyeSet;
  readonly tip: TipSignal;
  readonly look: MascotLook;
  /** Estilo por camada: pivô sempre; transform/opacity da pose quando houver. */
  readonly style: (layer: RigLayer) => CSSProperties;
}

/** Junta pose + props explícitas e devolve o que cada camada precisa. */
export function resolveRig(lod: RigLod, props: RigArtProps): ResolvedRig {
  const spec = RIG[lod];
  const p: RigPose | undefined = props.pose ? spec.poses[props.pose] : undefined;
  return {
    eyes: props.eyes ?? p?.eyes ?? 'open',
    tip: props.tip ?? p?.tip ?? 'off',
    look: props.look ?? p?.look ?? 'none',
    style(layer) {
      const [x, y] = spec.pivots[layer];
      const l = p?.layers[layer];
      return {
        transformBox: 'view-box',
        transformOrigin: `${x}px ${y}px`,
        ...(l?.transform !== undefined && { transform: l.transform }),
        ...(l?.opacity !== undefined && { opacity: l.opacity }),
      };
    },
  };
}

/** `useId` do React 19 traz caracteres que quebram `url(#…)`; isto devolve um id seguro. */
export function svgSafeId(reactId: string, prefix: string): string {
  return `${prefix}-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export function joinClass(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
