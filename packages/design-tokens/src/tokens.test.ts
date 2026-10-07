/**
 * Contrato dos tokens do DS 3.0 (F72-S01).
 *
 * 1. Contraste WCAG 2.1 dos pares semânticos nos DOIS temas, lidos do próprio
 *    `tokens.css` (texto ≥ 4,5:1; UI não textual ≥ 3:1). Falha se alguém
 *    empurrar um valor abaixo do piso.
 * 2. Nenhum token do v2 foi renomeado/removido.
 * 3. `typography.ts` e o `@theme` do `tokens.css` dizem a mesma coisa.
 *
 * `TOKENS_REPORT=1 pnpm --filter @hm/design-tokens test` imprime a tabela medida.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { typography } from './typography';
import type { TypeScaleToken } from './typography';

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')
  .replaceAll('\r\n', '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

type Vars = Record<string, string>;

/** Declarações `--x: valor;` do corpo de um bloco. */
function parseDecls(body: string): Vars {
  const out: Vars = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1];
    const value = m[2];
    if (name !== undefined && value !== undefined) out[name] = value.trim().replace(/\s+/g, ' ');
  }
  return out;
}

/** Corpo do bloco cujo seletor começa em `selector` (primeira ocorrência após `from`). */
function blockBody(selector: string, from = 0): { body: string; end: number } {
  const start = css.indexOf(selector, from);
  if (start < 0) throw new Error(`bloco não encontrado: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return { body: css.slice(open + 1, close), end: close };
}

const primitives = parseDecls(blockBody(':root {').body);
const darkBlock = parseDecls(blockBody(":root,\n[data-theme='dark'] {").body);
const lightBlock = parseDecls(blockBody("[data-theme='light'] {").body);

const themes = {
  dark: { ...primitives, ...darkBlock },
  light: { ...primitives, ...darkBlock, ...lightBlock },
} as const satisfies Record<string, Vars>;
type ThemeName = keyof typeof themes;

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function tok(theme: ThemeName, name: string): string {
  const v = themes[theme][`--${name}`];
  if (v === undefined || !v.startsWith('#')) throw new Error(`token --${name} (${theme}) não é hex: ${String(v)}`);
  return v;
}

const SURFACES = ['bg', 'bg-alt', 'surface', 'surface-2', 'surface-3', 'surface-inset'] as const;
const STATUS = ['danger', 'warn', 'info', 'success'] as const;

interface Pair {
  readonly theme: ThemeName;
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
  readonly kind: 'texto' | 'UI';
}

function buildPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const theme of ['dark', 'light'] as const) {
    const text = (fg: string, bg: string): void => {
      pairs.push({ theme, fg, bg, min: 4.5, kind: 'texto' });
    };
    for (const bg of SURFACES) {
      for (const fg of ['text', 'text-mid', 'text-low', 'brand-text', 'violet']) text(fg, bg);
    }
    for (const s of STATUS) {
      for (const bg of ['bg', 'surface', 'surface-2', 'surface-3']) text(s, bg);
      text(s, `${s}-bg`);
    }
    text('text-on-brand', 'brand');
    text('text-on-brand', 'brand-strong');
  }
  // Dark: a rampa clara da marca é usada como texto (eyebrow, métrica).
  for (const bg of SURFACES) {
    for (const fg of ['brand-soft', 'brand-bright', 'brand']) {
      pairs.push({ theme: 'dark', fg, bg, min: 4.5, kind: 'texto' });
    }
  }
  // UI não textual (foco, ícone de marca, indicador): ≥ 3:1.
  for (const bg of ['bg', 'surface', 'surface-3']) {
    pairs.push({ theme: 'dark', fg: 'brand', bg, min: 3, kind: 'UI' });
    pairs.push({ theme: 'light', fg: 'brand-text', bg, min: 3, kind: 'UI' });
  }
  return pairs;
}

const pairs = buildPairs();

describe('contraste WCAG 2.1 dos pares semânticos', () => {
  it.each(pairs.map((p) => [`${p.theme} · ${p.fg} sobre ${p.bg} (≥${p.min})`, p] as const))(
    '%s',
    (_label, p) => {
      expect(contrast(tok(p.theme, p.fg), tok(p.theme, p.bg))).toBeGreaterThanOrEqual(p.min);
    },
  );

  it('imprime a tabela medida (TOKENS_REPORT=1)', () => {
    if (process.env['TOKENS_REPORT'] !== '1') return;
    const rows = pairs.map(
      (p) =>
        `${p.theme}\t${p.kind}\t--${p.fg} ${tok(p.theme, p.fg)}\t--${p.bg} ${tok(p.theme, p.bg)}\t${contrast(tok(p.theme, p.fg), tok(p.theme, p.bg)).toFixed(2)}\t≥${p.min}`,
    );
    console.log(rows.join('\n'));
  });
});

/** Tokens do v2 (HEAD de F71) — nenhum pode sumir ou mudar de nome. */
const V2_TOKEN_NAMES = [
  'bg', 'bg-alt', 'border', 'border-2', 'border-brand', 'brand', 'brand-bright', 'brand-faint',
  'brand-price', 'brand-soft', 'brand-strong', 'danger', 'danger-bg', 'dur-base', 'dur-fast',
  'dur-slow', 'ease', 'ease-spring', 'elev-1', 'elev-2', 'elev-3', 'elev-4', 'font-body',
  'font-display', 'font-head', 'font-price', 'glow-active', 'glow-lg', 'glow-md', 'glow-sm',
  'info', 'info-bg', 'r-lg', 'r-md', 'r-pill', 'r-sm', 'r-xs', 'sp-1', 'sp-2', 'sp-3', 'sp-4',
  'sp-5', 'sp-6', 'sp-7', 'sp-8', 'sp-9', 'success', 'success-bg', 'surface', 'surface-2',
  'surface-3', 'surface-inset', 'text', 'text-body', 'text-body--font-weight',
  'text-body--letter-spacing', 'text-body--line-height', 'text-display',
  'text-display--font-weight', 'text-display--letter-spacing', 'text-display--line-height',
  'text-h1', 'text-h1--font-weight', 'text-h1--letter-spacing', 'text-h1--line-height', 'text-h2',
  'text-h2--font-weight', 'text-h2--letter-spacing', 'text-h2--line-height', 'text-h3',
  'text-h3--font-weight', 'text-h3--letter-spacing', 'text-h3--line-height', 'text-h4',
  'text-h4--font-weight', 'text-h4--letter-spacing', 'text-h4--line-height', 'text-low',
  'text-mid', 'text-on-brand', 'text-price', 'text-price--font-weight',
  'text-price--letter-spacing', 'text-price--line-height', 'text-small',
  'text-small--font-weight', 'text-small--letter-spacing', 'text-small--line-height', 'warn',
  'warn-bg',
] as const;

const V3_NEW_NAMES = [
  'bg-elevated', 'surface-glass', 'violet', 'brand-text', 'shadow-1', 'shadow-2', 'shadow-3',
  'glow', 'r-xl', 'font-mono',
] as const;

describe('contrato de nomes', () => {
  const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]?.slice(2)));

  it.each(V2_TOKEN_NAMES)('mantém --%s', (name) => {
    expect(declared.has(name)).toBe(true);
  });

  it.each(V3_NEW_NAMES)('declara o token novo --%s', (name) => {
    expect(declared.has(name)).toBe(true);
  });

  it('todo token semântico existe nos dois temas (claro não herda cor do dark por acidente)', () => {
    const mustOverride = [
      'bg', 'bg-alt', 'bg-elevated', 'surface', 'surface-2', 'surface-3', 'surface-inset',
      'surface-glass', 'text', 'text-mid', 'text-low', 'brand-text', 'violet', 'border',
      'border-2', 'border-brand', 'danger', 'danger-bg', 'warn', 'warn-bg', 'info', 'info-bg',
      'success', 'success-bg', 'shadow-1', 'shadow-2', 'shadow-3', 'glow',
    ];
    for (const n of mustOverride) expect(lightBlock[`--${n}`], `light --${n}`).toBeDefined();
  });

  it('aliases de fonte (ADR-002)', () => {
    expect(primitives['--font-price']).toBe('var(--font-mono)');
    expect(primitives['--font-display']).toBe('var(--font-head)');
    expect(primitives['--font-head']).toContain('Space Grotesk');
    expect(primitives['--font-body']).toContain('Manrope');
    expect(primitives['--font-mono']).toContain('IBM Plex Mono');
    for (const old of ['Orbitron', 'Rajdhani', 'Chakra Petch']) {
      expect(css.includes(old)).toBe(false);
    }
  });
});

describe('typography.ts espelha o @theme do tokens.css', () => {
  const theme = parseDecls(blockBody('@theme {').body);
  const keys = Object.keys(typography) as TypeScaleToken[];

  it.each(keys)('%s', (key) => {
    const s = typography[key];
    expect(theme[`--text-${key}`]).toBe(s.size);
    expect(theme[`--text-${key}--line-height`]).toBe(s.lineHeight);
    expect(theme[`--text-${key}--letter-spacing`]).toBe(s.tracking);
    expect(theme[`--text-${key}--font-weight`]).toBe(String(s.weight));
  });

  it('corpo 16px/500/1,65 e número em mono tabular', () => {
    expect(typography.body).toMatchObject({ size: '16px', weight: 500, lineHeight: '1.65' });
    expect(typography.price).toMatchObject({ family: 'mono', tabularNums: true });
  });
});
