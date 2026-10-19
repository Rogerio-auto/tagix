// Gera docs/design/auth-companion/poses.html a partir da ARTE REAL (F76-S10).
//
//   node docs/design/auth-companion/poses.build.mjs
//
// - Renderiza apps/web/features/auth/companion/art/rig-*.tsx com react-dom/server (esbuild do
//   próprio repo, resolvido via apps/web → vitest → vite; nenhuma dependência nova).
// - Copia os tokens de packages/design-tokens/src/tokens.css para o :root da folha (nenhum hex
//   inventado: as cores da folha SÃO os tokens) e calcula os contrastes da tabela.
// - Inlina art/rig.css. A folha é estática: nada se move, nenhum script roda nela.
//
// Rode de novo sempre que a arte, o rig.json ou os tokens mudarem.

import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const WEB = join(ROOT, 'apps/web');
const ART = join(WEB, 'features/auth/companion/art');

// ── esbuild do repo ──────────────────────────────────────────────────────────
const fromWeb = createRequire(join(WEB, 'package.json'));
const fromVitest = createRequire(fromWeb.resolve('vitest/package.json'));
const fromVite = createRequire(fromVitest.resolve('vite/package.json'));
const esbuild = fromVite('esbuild');

const tmp = mkdtempSync(join(tmpdir(), 'hm-poses-'));
const outfile = join(tmp, 'render.cjs');
await esbuild.build({
  stdin: {
    contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { RigMd48 } from './rig-md-48';
      import { RigInline40 } from './rig-inline-40';
      import rig from './rig.json';
      import { ARRIVAL_BUBBLE, CONTEXT_BUBBLE } from '../copy';
      const C = { 'md-48': RigMd48, 'inline-40': RigInline40 };
      export function art(lod, props) { return renderToStaticMarkup(createElement(C[lod], props)); }
      export { rig, ARRIVAL_BUBBLE, CONTEXT_BUBBLE };
    `,
    resolveDir: ART,
    loader: 'tsx',
    sourcefile: 'poses-entry.tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  outfile,
  logLevel: 'error',
});
const { art, rig, ARRIVAL_BUBBLE, CONTEXT_BUBBLE } = createRequire(outfile)(outfile);
rmSync(tmp, { recursive: true, force: true });

// ── tokens ───────────────────────────────────────────────────────────────────
const tokensCss = readFileSync(join(ROOT, 'packages/design-tokens/src/tokens.css'), 'utf8');
const block = (selectorRe) => {
  const m = tokensCss.match(selectorRe);
  if (!m) throw new Error(`bloco de tokens não encontrado: ${selectorRe}`);
  return m[1].trim();
};
const PRIMITIVES = block(/\n:root \{([\s\S]*?)\n\}/);
const DARK = block(/:root,\s*\[data-theme='dark'\] \{([\s\S]*?)\n\}/);
const LIGHT = block(/\[data-theme='light'\] \{([\s\S]*?)\n\}/);
const vars = (src) =>
  Object.fromEntries([...src.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const T = {
  dark: { ...vars(PRIMITIVES), ...vars(DARK) },
  light: { ...vars(PRIMITIVES), ...vars(DARK), ...vars(LIGHT) },
};
const rigCss = readFileSync(join(ART, 'rig.css'), 'utf8');

// Contraste WCAG 2.x.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const MAP = rig.tokens;
const tokenOf = (mVar, theme) => MAP[mVar][theme].replace(/^--/, '--');
const hexOf = (mVar, theme) => T[theme][tokenOf(mVar, theme)];
const fmt = (n) => n.toFixed(2).replace('.', ',');

const contrastRows = [
  ['--m-ink', 'traço', ['--bg', '--bg-elevated'], 3],
  ['--m-accent', 'ponta acesa, halo', ['--bg', '--bg-elevated'], 3],
  ['--m-warn', 'ponta em confused', ['--bg', '--bg-elevated'], 3],
  ['--m-eye', 'olho sobre o visor', ['visor'], 3],
  ['--m-ink', 'traço sobre o casco', ['fill'], 3],
]
  .map(([mVar, uso, against, min]) => {
    const cells = ['dark', 'light']
      .map((theme) => {
        const fg = hexOf(mVar, theme);
        return against
          .map((bgName) => {
            const bg =
              bgName === 'visor'
                ? hexOf('--m-visor', theme)
                : bgName === 'fill'
                  ? hexOf('--m-fill', theme)
                  : T[theme][bgName];
            const r = ratio(fg, bg);
            const label =
              bgName === 'visor' ? '--m-visor' : bgName === 'fill' ? '--m-fill' : bgName;
            return `<span class="ct ${r >= min ? 'ok' : 'bad'}"><b>${fmt(r)}:1</b> ${label}</span>`;
          })
          .join('');
      })
      .map((c) => `<td>${c}</td>`)
      .join('');
    return `<tr><td><code>${mVar}</code><small>${uso}</small></td><td><code>${tokenOf(mVar, 'dark')}</code> · <code>${tokenOf(
      mVar,
      'light',
    )}</code></td>${cells}<td class="mono">≥ ${min}:1</td></tr>`;
  })
  .join('\n');

// ── peças da folha ───────────────────────────────────────────────────────────
const fig = (lod, props = {}, scale = 1) => {
  const size = rig.lods[lod].size;
  return `<span class="fig" style="width:${size * scale}px;height:${size * scale}px">${art(lod, {
    ...props,
    className: `s${scale}`,
  })}</span>`;
};

const STATES_48 = [
  [
    'rest',
    'repouso',
    'padrão; após a entrada e cada pouso',
    'respira 3 ciclos (4,2 s) e para; pisca a cada 4–9 s',
    {},
  ],
  [
    'blink',
    'piscar · meio',
    'aleatório 4–9 s, só visível',
    '140 ms --ease · scaleY 1 → 0,12 → 1',
    { pose: 'blink' },
  ],
  [
    'look',
    'look · perch',
    'posto perch; erro de validação',
    '200 ms --ease · olhos ±2 px',
    { look: 'left' },
  ],
  [
    'avert',
    'avert',
    'focusin em type=password',
    '240 ms --ease · cabeça +8°, x +1,5 · volta em 200 ms',
    { pose: 'avert' },
  ],
  [
    'thinking',
    'thinking',
    'envio pendente ≥ 300 ms',
    '1,6 s linear ∞ · ponta gira e pulsa',
    { pose: 'thinking' },
  ],
  [
    'confused',
    'confused',
    'credencial, servidor, link inválido',
    '240 ms --ease-spring · −9° · fica até o próximo foco',
    { pose: 'confused' },
  ],
  ['crouch', 'celebrate · 0–100', 'sucesso', 'agacha 0,92 (scaleX 1,04)', { pose: 'crouch' }],
  [
    'jump',
    'celebrate · pico',
    'sucesso',
    '100–360 ms --ease-spring · −6 px · halo',
    { pose: 'jump' },
  ],
  ['land', 'celebrate · pouso', 'sucesso', '360–620 ms · 0,95 e mola', { pose: 'land' }],
  [
    'success',
    'sucesso final',
    'tela de sucesso que fica',
    'pose final: olhos felizes, ponta acesa',
    { pose: 'success' },
  ],
];
const STATES_40 = [
  ['rest', 'repouso', {}],
  ['blink', 'piscar · meio', { pose: 'blink' }],
  ['avert', 'avert', { pose: 'avert' }],
  ['thinking', 'thinking', { pose: 'thinking' }],
  ['confused', 'confused', { pose: 'confused' }],
  ['jump', 'celebrate · pico', { pose: 'jump' }],
  ['success', 'sucesso final', { pose: 'success' }],
];

const stateCell = ([, name, gatilho, tempo, props], ground) => `
  <figure class="cell ${ground}">
    <div class="stage">${fig('md-48', props, 2)}<span class="one">${fig('md-48', props, 1)}<i>1×</i></span></div>
    <figcaption><b>${name}</b><span>${gatilho}</span><span class="mono">${tempo}</span></figcaption>
  </figure>`;

const cell40 = ([, name, props]) => `
  <figure class="cell">
    <div class="stage">${fig('inline-40', props, 2)}<span class="one">${fig('inline-40', props, 1)}<i>1×</i></span></div>
    <figcaption><b>${name}</b></figcaption>
  </figure>`;

// Anatomia: pivôs sobre a figura ampliada.
const anatomy = (lod, scale) => {
  const L = rig.lods[lod];
  const pts = Object.entries(L.pivots)
    .map(
      ([name, [x, y]]) =>
        `<g class="pv"><circle cx="${x}" cy="${y}" r="0.9"/><path d="M${x - 1.8} ${y}h3.6M${x} ${y - 1.8}v3.6"/><title>${name} (${x}, ${y})</title></g>`,
    )
    .join('');
  const list = Object.entries(L.pivots)
    .map(([name, [x, y]]) => `<li><code>${name}</code><span class="mono">${x}, ${y}</span></li>`)
    .join('');
  return `
    <div class="anat">
      <div class="anat-fig" style="width:${L.size * scale}px;height:${L.size * scale}px">
        <span class="pxgrid" style="background-size:${scale}px ${scale}px"></span>
        ${art(lod, { className: 'fill' })}
        <svg class="pivots" viewBox="${L.viewBox}" aria-hidden="true">${pts}</svg>
      </div>
      <div class="anat-meta">
        <p class="eyebrow">${lod} · ${L.size}×${L.size} · ${scale}×</p>
        <ul class="pvlist">${list}</ul>
        ${L.fused?.length ? `<p class="note">Fundidos ao corpo: ${L.fused.map((f) => `<code>${f}</code>`).join(' ')}. Grupos vazios mantêm o contrato de camadas.</p>` : ''}
      </div>
    </div>`;
};

// Voo: quadros reais (1×) ao longo do arco calculado como no motor (SPEC §4.2).
const cubic = (p1x, p1y, p2x, p2y) => (t) => {
  // resolve x(s) = t por Newton e devolve y(s)
  const bx = (s) => 3 * (1 - s) ** 2 * s * p1x + 3 * (1 - s) * s ** 2 * p2x + s ** 3;
  const by = (s) => 3 * (1 - s) ** 2 * s * p1y + 3 * (1 - s) * s ** 2 * p2y + s ** 3;
  let s = t;
  for (let i = 0; i < 12; i++) {
    const dx = (bx(s + 1e-4) - bx(s - 1e-4)) / 2e-4 || 1;
    s = Math.min(1, Math.max(0, s - (bx(s) - t) / dx));
  }
  return by(s);
};
const flight = () => {
  const W = 560;
  const H = 190;
  const from = [40, 150];
  const to = [500, 120];
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const lift = Math.min(56, Math.max(24, dist * 0.12));
  const apexY = Math.min(from[1], to[1]) - lift;
  const dur = Math.round(Math.min(760, Math.max(560, 420 + dist * 0.45)));
  const ex = cubic(0.4, 0, 0.1, 1);
  const ease = cubic(0.2, 0.8, 0.2, 1);
  const pos = (t) => {
    const x = from[0] + (to[0] - from[0]) * ex(t);
    const y =
      t <= 0.45
        ? from[1] + (apexY - from[1]) * ease(t / 0.45)
        : apexY + (to[1] - apexY) * ease((t - 0.45) / 0.55);
    return [x, y];
  };
  const path = Array.from({ length: 61 }, (_, i) => pos(i / 60))
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join('');
  const frames = [
    [0, 'anticipate', 'antecipação · 0–80 ms'],
    [0.2, 'stretch', 'estica e inclina'],
    [0.45, 'apex', `ápice · −${Math.round(lift)} px`],
    [1, 'squash', 'pouso · amassa 120 ms'],
  ]
    .map(([t, pose, label]) => {
      const [x, y] = pos(t);
      return `<span class="fl" style="left:${(x - 24).toFixed(1)}px;top:${(y - 43).toFixed(1)}px">${art(
        'md-48',
        {
          pose,
        },
      )}<i>${label}</i></span>`;
    })
    .join('');
  return `
    <div class="flight" style="width:${W}px;height:${H}px">
      <svg class="arc" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${path}"/></svg>
      ${frames}
    </div>
    <p class="mono note">distância ${Math.round(dist)} px → duração ${dur} ms (clamp(560, 420 + d·0,45, 760)) · X cubic-bezier(.4,0,.1,1) · Y sobe até o ápice em .45 e assenta em --ease · tamanho real</p>`;
};

const bubble = (text, side = 'right') =>
  `<span class="bubble tail-${side}" aria-hidden="true">${text}</span>`;

// Contexto real, 1:1: posto heading com o balão de chegada; posto perch em avert.
const LOGO = `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect width="32" height="32" rx="9" style="fill:var(--text)"/><path d="M11.25 8.75v12a3 3 0 0 0 3 3h8.5" fill="none" stroke-width="3.25" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--bg)"/><circle cx="21.75" cy="10.25" r="2.6" style="fill:var(--bg)"/></svg>`;
const contextHeading = () => `
  <div class="mock form-col">
    <header class="ah">
      <p class="ah-eyebrow"><span class="hl"></span>Acesso
        <span class="station heading">${bubble(ARRIVAL_BUBBLE.login)}${art('md-48', {})}</span>
      </p>
      <h1 class="ah-title">Entrar</h1>
      <p class="ah-lead">Acesse o seu workspace.</p>
    </header>
    <label class="lbl">Email<span class="inp"></span></label>
  </div>`;
const contextPerch = () => `
  <div class="mock split">
    <div class="form-col">
      <label class="lbl">Email<span class="inp"></span></label>
      <label class="lbl">Senha<span class="inp focus"><i class="dots">••••••••</i></span></label>
    </div>
    <div class="panel">
      <p class="panel-eyebrow"><span class="hl brand"></span>Atendimento · Vendas · Automação</p>
      <p class="panel-quote">Toda conversa vira o próximo passo.</p>
    </div>
    <span class="station perch">${art('md-48', { pose: 'avert' })}</span>
  </div>`;
const contextMobile = () => `
  <div class="mock phone">
    <div class="logo-row">
      <span class="logo">${LOGO}<b>Leadium</b></span>
      <span class="station inline">${art('inline-40', {})}${bubble(CONTEXT_BUBBLE['signup-sent'], 'up')}</span>
    </div>
    <p class="ah-eyebrow"><span class="hl"></span>Confirmação</p>
    <h1 class="ah-title sm">Verifique seu email</h1>
  </div>`;

const plate = (theme, inner) =>
  `<div class="plate" data-theme="${theme}" data-companion><p class="plate-tag">${
    theme === 'dark' ? 'Escuro' : 'Claro'
  }</p>${inner}</div>`;
const both = (inner) =>
  `<div class="pair">${plate('dark', inner())}${plate('light', inner())}</div>`;
const stacked = (inner) =>
  `<div class="stack">${plate('dark', inner())}${plate('light', inner())}</div>`;

const states48 = () =>
  `<div class="grid">${STATES_48.map((s, i) => stateCell(s, i === 2 || i === 3 ? 'on-elevated' : 'on-bg')).join('')}</div>`;
const states40 = () => `<div class="grid g40">${STATES_40.map(cell40).join('')}</div>`;

// ── HTML ─────────────────────────────────────────────────────────────────────
const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Folha de poses · companheiro das telas de acesso · Leadium</title>
<!-- GERADO por poses.build.mjs a partir de apps/web/features/auth/companion/art/*. Não edite à mão. -->
<style>
/* ── Tokens copiados de packages/design-tokens/src/tokens.css (sem nenhum valor inventado) ── */
:root {
${PRIMITIVES}
}
:root, [data-theme='dark'] {
${DARK}
}
[data-theme='light'] {
${LIGHT}
}

/* ── Arte: apps/web/features/auth/companion/art/rig.css (inlinado) ── */
${rigCss}

/* ── Folha ── */
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font: 500 15px/1.6 var(--font-body); -webkit-font-smoothing: antialiased; }
code, .mono { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: 0; }
.wrap { max-width: 1320px; margin: 0 auto; padding: 72px 40px 120px; }
.eyebrow { display: flex; align-items: center; gap: 10px; margin: 0; font: 500 11.5px/1.3 var(--font-mono); text-transform: uppercase; letter-spacing: .14em; color: var(--text-low); }
.eyebrow::before { content: ""; width: 20px; height: 1px; background: var(--border-2); }
h1.sheet { margin: 18px 0 0; font: 600 60px/1.04 var(--font-head); letter-spacing: -.045em; max-width: 14ch; }
.lead { max-width: 64ch; color: var(--text-mid); font-size: 16px; line-height: 1.65; margin: 20px 0 0; }
.lead b { color: var(--text); font-weight: 600; }
section { margin-top: 96px; }
.hero { display: grid; grid-template-columns: 1fr auto; gap: 64px; align-items: end; }
.hero-fig { display: flex; flex-direction: column; align-items: center; gap: 16px; padding-right: 40px; }
.hero-fig .mono { color: var(--text-low); font-size: 10.5px; }
section > header { display: grid; grid-template-columns: 220px 1fr; gap: 24px; align-items: baseline; border-top: 1px solid var(--border); padding-top: 20px; margin-bottom: 28px; }
section > header h2 { margin: 0; font: 600 28px/1.15 var(--font-head); letter-spacing: -.035em; }
section > header p { margin: 8px 0 0; color: var(--text-mid); max-width: 70ch; }
.num { font: 500 11.5px/1 var(--font-mono); color: var(--text-low); letter-spacing: .14em; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.stack { display: grid; gap: 16px; }
.plate { position: relative; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 44px 24px 24px; }
.plate-tag { position: absolute; top: 14px; left: 24px; margin: 0; font: 500 10.5px/1 var(--font-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--text-low); }
.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
.cell { margin: 0; background: var(--bg); padding: 18px 16px 16px; display: flex; flex-direction: column; gap: 14px; }
.cell.on-elevated { background: var(--bg-elevated); }
.stage { position: relative; height: 128px; display: grid; place-items: center; }
.stage .one { position: absolute; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.stage .one i { font: 500 10px/1 var(--font-mono); font-style: normal; color: var(--text-low); }
.fig { display: inline-block; }
.fig .m-rig { width: 100%; height: 100%; }
figcaption { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; line-height: 1.45; color: var(--text-mid); }
figcaption b { font: 600 13.5px/1.3 var(--font-head); color: var(--text); letter-spacing: -.01em; }
figcaption .mono { color: var(--text-low); font-size: 10.5px; }
.g40 { grid-template-columns: repeat(7, 1fr); }
.g40 .stage { height: 112px; }

.anatomy { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
.anat { display: flex; gap: 28px; align-items: flex-start; }
.anat-fig { position: relative; flex: none; border: 1px solid var(--border); border-radius: var(--r-sm); }
.anat-fig .m-rig { position: absolute; inset: 0; width: 100%; height: 100%; }
.pxgrid { position: absolute; inset: 0; background-image: linear-gradient(color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px); border-radius: inherit; }
.pivots { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.pv circle { fill: var(--danger); }
.pv path { stroke: var(--danger); stroke-width: .3; }
.anat-meta { min-width: 0; }
.pvlist { list-style: none; margin: 12px 0 0; padding: 0; columns: 2; column-gap: 20px; }
.pvlist li { white-space: nowrap; display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; border-bottom: 1px solid var(--border); break-inside: avoid; }
.pvlist code { color: var(--text); }
.pvlist .mono { color: var(--text-low); }
.note { margin: 12px 0 0; color: var(--text-low); font-size: 12.5px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font: 500 10.5px/1.3 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--text-low); }
td small { display: block; color: var(--text-low); font-size: 12px; margin-top: 2px; }
.ct { display: block; white-space: nowrap; font-family: var(--font-mono); font-size: 11.5px; color: var(--text-mid); }
.ct b { color: var(--text); font-weight: 600; }
.ct.bad b { color: var(--danger); }

.flight { position: relative; margin: 8px auto 0; }
.arc { position: absolute; inset: 0; overflow: visible; }
.arc path { fill: none; stroke: var(--border-2); stroke-width: 1.5; stroke-dasharray: 2 5; stroke-linecap: round; }
.fl { position: absolute; width: 48px; height: 48px; }
.fl i { position: absolute; top: 56px; left: 50%; transform: translateX(-50%); white-space: nowrap; font: 500 10.5px/1 var(--font-mono); font-style: normal; color: var(--text-low); }
.flight + .note { text-align: center; }

/* Balão (SPEC §2.4). */
.bubble { position: absolute; display: inline-block; max-width: 26ch; padding: 6px 10px; border: 1px solid var(--border-2); border-radius: var(--r-lg); background: var(--surface-3); color: var(--text); font: 500 13px/1.35 var(--font-body); text-transform: none; letter-spacing: 0; box-shadow: var(--shadow-1); white-space: nowrap; }
.bubble::after { content: ""; position: absolute; width: 6px; height: 6px; background: var(--surface-3); border: 1px solid var(--border-2); }
.bubble.tail-right::after { right: -4px; top: 50%; margin-top: -3px; transform: rotate(45deg); border-left: 0; border-bottom: 0; }
.bubble.tail-up::after { top: -4px; right: 16px; transform: rotate(45deg); border-right: 0; border-bottom: 0; }

/* Mocks 1:1 das telas de acesso. */
.mock { position: relative; }
.form-col { width: 400px; }
.ah { display: flex; flex-direction: column; gap: 12px; margin-bottom: 28px; padding-top: 56px; }
.ah-eyebrow { position: relative; display: flex; align-items: center; gap: 10px; margin: 0; font: 500 12px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .14em; color: var(--text-low); }
.hl { width: 20px; height: 1px; background: var(--border-2); }
.hl.brand { background: var(--brand-text); }
.ah-title { margin: 0; font: 600 40px/1.08 var(--font-head); letter-spacing: -.035em; }
.ah-title.sm { font-size: 28px; line-height: 1.15; }
.ah-lead { margin: 0; color: var(--text-mid); font-size: 16px; line-height: 1.65; }
.lbl { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; font-size: 13px; font-weight: 700; color: var(--text); }
.inp { display: flex; align-items: center; height: 48px; padding: 0 14px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface-2); }
.inp.focus { border-color: var(--border-brand); box-shadow: var(--glow-md); }
.dots { font-style: normal; letter-spacing: .2em; color: var(--text-mid); }
.station { position: absolute; }
/* heading: os pés na linha do eyebrow (centro da sombra = base do eyebrow), 24 px da borda. */
.station.heading { right: 0; bottom: -6px; width: 48px; height: 48px; }
.station.heading .bubble { right: calc(100% + 6px); top: 9px; }
.split { position: relative; display: grid; grid-template-columns: 400px 1fr; min-height: 300px; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
.split .form-col { padding: 32px 40px 0 32px; width: auto; }
.split .lbl { line-height: 20px; }
.panel { position: relative; border-left: 1px solid var(--border); background: var(--bg-elevated); padding: 32px 40px; display: flex; flex-direction: column; justify-content: space-between; }
.panel-eyebrow { margin: 0; display: flex; align-items: center; gap: 10px; font: 500 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .14em; color: var(--text-low); }
.panel-quote { margin: 0 0 0 96px; max-width: 16ch; font: 600 28px/1.15 var(--font-head); letter-spacing: -.035em; color: var(--text); }
/* perch: x = borda do painel + 72 px (centro da figura); y = centro do campo focado (152 + 24). */
.station.perch { left: calc(400px + 72px - 24px); top: 152px; width: 48px; height: 48px; }
.phone { width: 375px; padding: 0 20px 24px; border: 1px solid var(--border); border-radius: 28px; }
.logo-row { position: relative; display: flex; align-items: center; justify-content: space-between; height: 64px; margin-bottom: 40px; }
.logo { display: inline-flex; align-items: center; gap: 10px; }
.logo b { font: 600 20px/1 var(--font-head); letter-spacing: -.035em; }
.station.inline { position: relative; display: block; width: 40px; height: 40px; }
.station.inline .bubble { top: calc(100% + 8px); right: 0; }
.ctx-row { display: flex; flex-wrap: wrap; gap: 56px; align-items: flex-start; margin-bottom: 40px; }
.ctx-cap { margin: 14px 0 0; font-size: 12.5px; color: var(--text-low); max-width: 44ch; }

.rules { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
.rules div { background: var(--bg); padding: 18px 20px; }
.rules h3 { margin: 0 0 6px; font: 600 15px/1.3 var(--font-head); letter-spacing: -.02em; }
.rules p { margin: 0; color: var(--text-mid); font-size: 13.5px; }
footer.sheet { margin-top: 96px; padding-top: 20px; border-top: 1px solid var(--border); color: var(--text-low); font-size: 12.5px; }
</style>
</head>
<body data-theme="dark">
<main class="wrap">
  <div class="hero"><div>
  <p class="eyebrow">F76-S10 · Folha de poses · estática</p>
  <h1 class="sheet">Quem te recebe na porta.</h1>
  <p class="lead">O mesmo robô do Copiloto, nas telas de acesso. <b>Calmo, monocromático, editorial.</b> A ponta da antena é o único ponto de cor e só acende quando significa algo. A assinatura é a sombra de contato: encolhe com a altura e dá peso ao voo sem efeito nenhum. Tudo aqui é a arte real (<code>art/rig-*.tsx</code>) renderizada nos tokens reais (<code>tokens.css</code>).</p>
  </div><div class="hero-fig" data-companion>${fig('md-48', { look: 'left' }, 5)}<span class="mono">md 48 · 5× · olhando o texto</span></div></div>

  <section id="anatomia">
    <header><div><span class="num">01</span><h2>Anatomia</h2></div><p>Camadas e pivôs do <code>rig.json</code> sobre a grade de pixel do próprio LOD. Traço único de 1,5 px; a borda externa de cada contorno cai em pixel inteiro. O 40 não é o 48 reduzido: é redesenhado, com o rosto maior e os braços fundidos ao corpo.</p></header>
    ${stacked(() => `<div class="anatomy">${anatomy('md-48', 6)}${anatomy('inline-40', 6)}</div>`)}
  </section>

  <section id="paleta">
    <header><div><span class="num">02</span><h2>Paleta e contraste</h2></div><p>Só tokens existentes, mapeados em variáveis locais <code>--m-*</code> sob <code>[data-companion]</code>. Elementos gráficos pedem ≥ 3:1 (WCAG 1.4.11). Números calculados pelo gerador a partir do <code>tokens.css</code>.</p></header>
    <table>
      <thead><tr><th>Variável</th><th>Token (escuro · claro)</th><th>Escuro</th><th>Claro</th><th>Piso</th></tr></thead>
      <tbody>${contrastRows}</tbody>
    </table>
  </section>

  <section id="estados">
    <header><div><span class="num">03</span><h2>Estados · md 48</h2></div><p>Quadro-pose de cada estado (o mesmo que o movimento reduzido mostra parado). Ampliado 2× e em tamanho real no canto. <code>look</code> e <code>avert</code> sobre <code>--bg-elevated</code> (o painel onde fica o <code>perch</code>); o resto sobre <code>--bg</code>.</p></header>
    ${stacked(states48)}
  </section>

  <section id="voo">
    <header><div><span class="num">04</span><h2>Voo entre postos</h2></div><p>De <code>heading</code> a <code>perch</code> no primeiro foco, e de volta na troca de etapa. Antecipa, estica inclinado, a sombra encolhe no ápice, amassa no pouso e a antena atrasa. Nunca mais que 760 ms.</p></header>
    ${both(flight)}
  </section>

  <section id="celular">
    <header><div><span class="num">05</span><h2>Celular · inline 40</h2></div><p>Caixa de 40×40 reservada no SSR na linha do logotipo. Não voa: troca de estado no lugar. Os mesmos estados, menos o voo e o aceno.</p></header>
    ${stacked(states40)}
  </section>

  <section id="contexto">
    <header><div><span class="num">06</span><h2>Posto = significado</h2></div><p>Em tamanho real. À esquerda, <b>agora é aqui</b>: em pé na linha do eyebrow, com o balão de chegada, sem tocar o título. Ao centro, <b>não estou olhando</b>: no painel, na altura do campo de senha, olhos fechados e cabeça virada para fora. À direita, o celular: posto <code>inline</code> com o balão contextual por baixo.</p></header>
    ${stacked(
      () => `<div class="ctx-row">
        <div>${contextHeading()}<p class="ctx-cap">heading · chegada · balão 1 (uma vez por sessão)</p></div>
        <div>${contextMobile()}<p class="ctx-cap">inline · signup-sent · balão 2</p></div>
      </div>
      <div>${contextPerch()}<p class="ctx-cap">perch · avert · foco no campo de senha</p></div>`,
    )}
  </section>

  <section id="regras">
    <header><div><span class="num">07</span><h2>O que não muda</h2></div><p>Regras de arte que valem para qualquer pose nova.</p></header>
    <div class="rules">
      <div><h3>Uma cor</h3><p>Tinta, casco e vidro são neutros dos tokens. Só a ponta da antena (e o halo, por 480 ms) usa <code>--m-accent</code>; <code>--brand</code> fica para o CTA.</p></div>
      <div><h3>Um traço</h3><p>1,5 px em todo contorno, pontas e juntas redondas, sem gradiente interno, sem brilho, sem roxo, sem faísca.</p></div>
      <div><h3>Um ator</h3><p>Um robô por tela, sempre <code>aria-hidden</code>, nunca na frente do título, do campo focado ou do botão.</p></div>
    </div>
  </section>

  <footer class="sheet">Gerado por <code>docs/design/auth-companion/poses.build.mjs</code> a partir de <code>apps/web/features/auth/companion/art/</code> e <code>packages/design-tokens/src/tokens.css</code>. Arte original do Leadium; o reel de referência empresta só a coreografia.</footer>
</main>
</body>
</html>
`;

writeFileSync(join(HERE, 'poses.html'), html);
console.log(`poses.html escrito (${(html.length / 1024).toFixed(1)} KB)`);
