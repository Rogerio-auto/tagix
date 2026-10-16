/**
 * Helpers de acessibilidade e prova visual reaproveitáveis pelos specs do DS 3.0
 * (F72-S07; follow-up (c) da F72-S06: os specs DS3 copiavam estes helpers um a um).
 *
 * - `expectNoSeriousAxe`: axe-core (WCAG 2.0/2.1 A e AA) sem violação `serious`/`critical`.
 *   O repositório não depende de `@axe-core/playwright` (e instalar pacote está fora da
 *   slot); o `axe-core` puro já está no store do pnpm e é injetado na página — mesmo motor,
 *   mesmas regras. Sem o arquivo, o teste é PULADO com o motivo (nunca passa em silêncio).
 * - `minTextContrast`: menor contraste WCAG entre o texto visível e o fundo EFETIVO
 *   (composição das camadas até o `<html>`), com a lista dos piores para o diagnóstico.
 * - `capture`: duas capturas por tela em `e2e/.artifacts/<lote>/` — a primeira dobra e a
 *   página inteira (o shell rola por dentro do `<main>`, então `fullPage` não basta).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './test';

export type Theme = 'dark' | 'light';

/** Fixa o tema antes do primeiro paint (o app lê `hm:theme` no boot). */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
}

/** Caminho do `axe.min.js` no store do pnpm, ou `null`. */
export function findAxe(): string | null {
  const store = path.resolve(process.cwd(), '../../node_modules/.pnpm');
  if (!fs.existsSync(store)) return null;
  const dir = fs.readdirSync(store).find((d) => d.startsWith('axe-core@'));
  if (!dir) return null;
  const file = path.join(store, dir, 'node_modules/axe-core/axe.min.js');
  return fs.existsSync(file) ? file : null;
}

export interface AxeFinding {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

/**
 * Roda o axe na página (ou num recorte) e falha em qualquer violação séria/crítica.
 * `exclude`: seletores fora da responsabilidade da tela (ex.: um widget de terceiro).
 */
export async function expectNoSeriousAxe(
  page: Page,
  options: { include?: string; exclude?: string[]; label?: string } = {},
): Promise<AxeFinding[]> {
  const axePath = findAxe();
  test.skip(axePath === null, 'axe-core não está no store do pnpm (o repo não depende dele)');
  await page.addScriptTag({ path: axePath as string });
  const findings = await page.evaluate(
    async ({ include, exclude }) => {
      interface AxeResult {
        violations: {
          id: string;
          impact: string | null;
          help: string;
          nodes: { target: unknown[] }[];
        }[];
      }
      const w = window as unknown as {
        axe: { run: (ctx: unknown, opts: unknown) => Promise<AxeResult> };
      };
      const context =
        include || exclude.length > 0
          ? { include: include ? [include] : [document], exclude: exclude.map((s) => [s]) }
          : document;
      const r = await w.axe.run(context, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
      }));
    },
    { include: options.include ?? null, exclude: options.exclude ?? [] },
  );
  const serious = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');
  expect(serious, `${options.label ?? 'axe'}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  return findings;
}

export interface ContrastReport {
  min: number;
  worst: { text: string; ratio: number; color: string; background: string }[];
}

/**
 * Menor contraste (WCAG 2.x) entre cada texto visível dentro de `selector` e o fundo
 * efetivo atrás dele. Ignora o que o WCAG isenta ou não está à vista: `sr-only`, opacidade
 * zero (dicas fechadas), controles inativos (`aria-disabled`/`disabled`, WCAG 1.4.3) e
 * texto sobre imagem.
 */
export async function minTextContrast(page: Page, selector: string): Promise<ContrastReport> {
  return page.evaluate((sel) => {
    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      const m = css.match(/[\d.]+/g)?.map(Number) ?? [];
      return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 1];
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const mix = (i: 0 | 1 | 2): number => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
      return [mix(0), mix(1), mix(2), a];
    };
    const channel = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: Rgba): number => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    const ratio = (a: Rgba, b: Rgba): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    };

    const backgroundOf = (el: Element): Rgba | null => {
      const layers: Rgba[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('linear-gradient')) return null;
        const bg = parse(cs.backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let acc: Rgba = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const layer = layers[i];
        if (layer) acc = over(layer, acc);
      }
      return acc;
    };

    const hidden = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return true;
        if (n.classList.contains('sr-only')) return true;
        if (n.getAttribute('aria-disabled') === 'true' || n.hasAttribute('disabled')) return true;
      }
      return false;
    };

    const results: { text: string; ratio: number; color: string; background: string }[] = [];
    for (const root of Array.from(document.querySelectorAll(sel))) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => (n.textContent ?? '').trim())
          .join(' ')
          .trim();
        if (!own || el.getClientRects().length === 0 || hidden(el)) continue;
        const bg = backgroundOf(el);
        if (!bg) continue;
        const cs = getComputedStyle(el);
        const fg = over(parse(cs.color), bg);
        results.push({
          text: own.slice(0, 40),
          ratio: Math.round(ratio(fg, bg) * 100) / 100,
          color: cs.color,
          background: `rgb(${bg.slice(0, 3).map(Math.round).join(' ')})`,
        });
      }
    }
    results.sort((a, b) => a.ratio - b.ratio);
    return { min: results[0]?.ratio ?? Infinity, worst: results.slice(0, 5) };
  }, selector);
}

/** Falha se algum texto visível em `selector` ficar abaixo de `min` (padrão 4,5:1). */
export async function expectTextContrast(page: Page, selector: string, label: string, min = 4.5): Promise<number> {
  const report = await minTextContrast(page, selector);
  expect(report.min, `${label}: piores ${JSON.stringify(report.worst)}`).toBeGreaterThanOrEqual(min);
  return report.min;
}

/**
 * Captura `<dir>/<nome>-<largura>-<tema>.png` (primeira dobra) e `...-inteira.png` (o
 * `<main>` inteiro: a viewport estica até ele não rolar). Espera rede, fontes e fim de
 * animação; animações CSS congeladas pelo próprio Playwright.
 */
export async function capture(
  page: Page,
  dir: string,
  name: string,
  theme: Theme,
  options: { full?: boolean } = {},
): Promise<void> {
  const viewport = page.viewportSize();
  const width = viewport?.width ?? 0;
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: `${dir}/${name}-${width}-${theme}.png`, animations: 'disabled' });
  if (options.full === false || !viewport) return;
  const main = page.locator('main').first();
  if ((await main.count()) === 0) return;
  const extra = await main.evaluate((el) => el.scrollHeight - el.clientHeight);
  if (extra <= 0) return;
  await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height + extra, 6000) });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/${name}-${width}-${theme}-inteira.png`, animations: 'disabled' });
  await page.setViewportSize(viewport);
}
