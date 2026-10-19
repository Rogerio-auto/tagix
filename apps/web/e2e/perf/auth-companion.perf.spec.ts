/**
 * F76-S13 — Desempenho do companheiro das telas de acesso (ADR-006 §9; SPEC §11).
 *
 * Mede, sobre o build de PRODUÇÃO (`next build` + `next start`, `E2E_SERVER=start`):
 *
 * 1. PESO: gzip -9 dos chunks que contêm `COMPANION_CHUNK_MARKER` (figura, voo, balão), do
 *    chunk do diretor (a chave de saudação vive em `copy.ts`) e do CSS do companheiro.
 *    Meta 12 KB, teto duro 30 KB.
 * 2. CARREGAMENTO: o marcador não está em nenhum script inicial das rotas de acesso (nem no
 *    HTML servido, nem no manifest do build) e o chunk só é pedido depois de FCP + 400 ms.
 * 3. LCP: o elemento do maior paint nunca está dentro do companheiro.
 * 4. CLS: soma dos `layout-shift` sem input recente < 0,01 (desktop e celular), e o
 *    companheiro não acrescenta deslocamento em relação à mesma tela sem ele.
 * 5. OCIOSIDADE: 15 s parado => só o piscar (ou nada) em `document.getAnimations()`; aba
 *    oculta ou personagem fora da viewport => nada rodando.
 * 6. MOVIMENTO REDUZIDO: nenhuma animação de transform no palco (sem voo, sem respiração).
 *
 * Sem `.next` de produção no disco, os testes são pulados com o motivo (nunca passam em
 * silêncio). Rodar com `--workers=1`: medir desempenho em paralelo mede a contenção.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { waitForHydration } from '../pages/pom';

test.use({ storageState: { cookies: [], origins: [] } });
// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

const NEXT_DIR = path.resolve(process.cwd(), '.next');
const COMPANION_DIR = path.resolve(process.cwd(), 'features/auth/companion');
const KB = 1024;
const META_KB = 12;
const HARD_CAP_KB = 30;

const production = fs.existsSync(path.join(NEXT_DIR, 'BUILD_ID'));
test.skip(
  !production,
  'sem build de produção em apps/web/.next (rode `next build` e `E2E_SERVER=start`)',
);
test.skip(
  (process.env['E2E_SERVER'] ?? (process.env['CI'] ? 'start' : 'dev')) !== 'start',
  'desempenho só vale no servidor de produção (E2E_SERVER=start)',
);

/* ----------------------------------------------------------------------------------- */
/* Descoberta dos chunks                                                                */
/* ----------------------------------------------------------------------------------- */

function readConst(file: string, name: string): string {
  const source = fs.readFileSync(path.join(COMPANION_DIR, file), 'utf8');
  const match = new RegExp(`${name}\\s*(?::[^=]+)?=\\s*'([^']+)'`).exec(source);
  if (!match?.[1]) throw new Error(`${name} não encontrado em ${file}`);
  return match[1];
}

const MARKER = readConst('CompanionFigure.tsx', 'COMPANION_CHUNK_MARKER');
const GREETED_KEY = readConst('copy.ts', 'GREETED_STORAGE_KEY');

function walk(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const gz = (buffer: Buffer): number => zlib.gzipSync(buffer, { level: 9 }).length;

interface ChunkInfo {
  file: string;
  /** Caminho servido pelo Next (`/_next/static/...`). */
  url: string;
  raw: number;
  gzip: number;
}

function describeChunks(files: string[]): ChunkInfo[] {
  return files.map((file) => {
    const buffer = fs.readFileSync(file);
    const rel = path.relative(path.join(NEXT_DIR, 'static'), file).split(path.sep).join('/');
    return { file, url: `/_next/static/${rel}`, raw: buffer.length, gzip: gz(buffer) };
  });
}

function chunksContaining(dir: string, ext: string, needle: string): ChunkInfo[] {
  return describeChunks(walk(dir, ext).filter((f) => fs.readFileSync(f, 'utf8').includes(needle)));
}

const JS_DIR = path.join(NEXT_DIR, 'static', 'chunks');
const CSS_DIR = path.join(NEXT_DIR, 'static', 'css');

/* ----------------------------------------------------------------------------------- */
/* 1. PESO                                                                              */
/* ----------------------------------------------------------------------------------- */

test.describe('Companheiro — peso (gzip -9)', () => {
  test('figura + diretor + CSS dentro da meta de 12 KB (teto duro 30 KB)', async () => {
    const figure = chunksContaining(JS_DIR, '.js', MARKER);
    const director = chunksContaining(JS_DIR, '.js', GREETED_KEY);
    const css = chunksContaining(CSS_DIR, '.css', '.m-bubble');

    expect(
      figure.length,
      `nenhum chunk com o marcador ${MARKER}: o build é desta branch?`,
    ).toBeGreaterThan(0);
    expect(director.length, 'nenhum chunk com o diretor').toBeGreaterThan(0);
    expect(css.length, 'nenhum CSS do companheiro').toBeGreaterThan(0);

    // O diretor pode dividir o chunk com a figura; conta cada arquivo uma só vez.
    const js = new Map<string, ChunkInfo>();
    for (const c of [...figure, ...director]) js.set(c.file, c);
    const jsGzip = [...js.values()].reduce((n, c) => n + c.gzip, 0);
    const cssGzip = css.reduce((n, c) => n + c.gzip, 0);
    const total = jsGzip + cssGzip;

    const report = {
      figuraChunks: figure.map((c) => ({ url: c.url, raw: c.raw, gzip: c.gzip })),
      diretorChunks: director.map((c) => ({ url: c.url, raw: c.raw, gzip: c.gzip })),
      cssChunks: css.map((c) => ({ url: c.url, raw: c.raw, gzip: c.gzip })),
      jsGzipBytes: jsGzip,
      cssGzipBytes: cssGzip,
      totalGzipBytes: total,
      totalKB: Math.round((total / KB) * 100) / 100,
    };
    console.log(`PESO ${JSON.stringify(report, null, 2)}`);
    test.info().annotations.push({ type: 'peso', description: JSON.stringify(report) });

    expect(
      total,
      `peso total ${(total / KB).toFixed(2)} KB acima do teto duro`,
    ).toBeLessThanOrEqual(HARD_CAP_KB * KB);
    expect(total, `peso total ${(total / KB).toFixed(2)} KB acima da meta`).toBeLessThanOrEqual(
      META_KB * KB,
    );
  });

  test('o marcador nunca está nos scripts iniciais das rotas de acesso (manifest do build)', async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(NEXT_DIR, 'app-build-manifest.json'), 'utf8'),
    ) as {
      pages: Record<string, string[]>;
    };
    const authRoutes = Object.keys(manifest.pages).filter(
      (route) =>
        route.startsWith('/(auth)/') ||
        route.startsWith('/(public)/convite') ||
        route.includes('/login/') ||
        route.includes('/convite'),
    );
    expect(
      authRoutes.length,
      `rotas de acesso no manifest: ${Object.keys(manifest.pages).join(', ')}`,
    ).toBeGreaterThan(3);
    const offenders: string[] = [];
    for (const route of authRoutes) {
      for (const file of manifest.pages[route] ?? []) {
        const full = path.join(NEXT_DIR, file);
        if (!fs.existsSync(full)) continue;
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes(MARKER)) offenders.push(`${route} -> ${file}`);
        if (file.endsWith('.css') && content.includes('.m-bubble'))
          offenders.push(`${route} -> ${file} (css)`);
      }
    }
    expect(offenders, 'figura/CSS do companheiro no bundle inicial').toEqual([]);
  });
});

/* ----------------------------------------------------------------------------------- */
/* Sondas de navegador                                                                  */
/* ----------------------------------------------------------------------------------- */

interface PerfProbe {
  lcp: { tag: string; inCompanion: boolean; time: number; size: number }[];
  cls: { value: number; at: number }[];
  hidden: boolean;
  animations: { props: string[]; duration: number }[];
}

async function installPerfProbe(
  page: Page,
  options: { noCompanion?: boolean } = {},
): Promise<void> {
  await page.addInitScript((noCompanion) => {
    const probe: PerfProbe = { lcp: [], cls: [], hidden: false, animations: [] };
    (window as unknown as { __perf: PerfProbe }).__perf = probe;

    // `data-brand` fora de `leadium`: o companheiro não arma (linha de base sem ele).
    if (noCompanion) document.documentElement.setAttribute('data-brand', 'sem-companheiro');

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcp = entry as PerformanceEntry & { element?: Element | null; size?: number };
        probe.lcp.push({
          tag: lcp.element
            ? `${lcp.element.tagName.toLowerCase()}${lcp.element.className ? `.${String(lcp.element.getAttribute('class')).split(' ')[0]}` : ''}`
            : '(removido)',
          inCompanion: Boolean(lcp.element?.closest('[data-companion-stage]')),
          time: Math.round(lcp.startTime),
          size: lcp.size ?? 0,
        });
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput)
          probe.cls.push({ value: shift.value, at: Math.round(entry.startTime) });
      }
    }).observe({ type: 'layout-shift', buffered: true });

    // Aba oculta controlável.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => probe.hidden });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (probe.hidden ? 'hidden' : 'visible'),
    });

    // Animações criadas dentro do palco do companheiro.
    const original = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      opts?: number | KeyframeAnimationOptions,
    ): Animation {
      try {
        if (this.closest('[data-companion-stage]')) {
          const props = new Set<string>();
          if (Array.isArray(keyframes)) {
            for (const frame of keyframes) {
              for (const key of Object.keys(frame)) {
                if (key !== 'offset' && key !== 'easing' && key !== 'composite') props.add(key);
              }
            }
          }
          probe.animations.push({
            props: [...props],
            duration: typeof opts === 'number' ? opts : Number(opts?.duration ?? 0),
          });
        }
      } catch {
        /* a sonda nunca quebra a página */
      }
      return original.call(this, keyframes, opts);
    };
  }, options.noCompanion === true);
}

const perfOf = (page: Page): Promise<PerfProbe> =>
  page.evaluate(() => (window as unknown as { __perf: PerfProbe }).__perf);

const sumCls = (probe: PerfProbe): number => probe.cls.reduce((n, s) => n + s.value, 0);

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    (window as unknown as { __perf: PerfProbe }).__perf.hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Descrição curta das animações em execução (alvo + iterações). */
async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => {
        const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
        const timing = a.effect?.getTiming();
        const id =
          target?.getAttribute?.('data-layer') ??
          target?.getAttribute?.('class') ??
          target?.tagName ??
          '?';
        const inCompanion = Boolean(target?.closest?.('[data-companion-stage]'));
        return `${inCompanion ? 'companheiro' : 'pagina'}:${id}:x${String(timing?.iterations)}:${Math.round(Number(timing?.duration ?? 0))}ms`;
      }),
  );
}

const ARMED = '[data-companion-actor][data-placed="true"]';

async function openLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await waitForHydration(page.getByRole('button', { name: 'Entrar', exact: true }));
  await expect(page.locator(ARMED)).toHaveCount(1, { timeout: 15_000 });
}

/* ----------------------------------------------------------------------------------- */
/* 2. CARREGAMENTO LAZY                                                                 */
/* ----------------------------------------------------------------------------------- */

test.describe('Companheiro — carregamento lazy (1440)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('HTML servido sem o chunk da figura; chunk só pedido depois de FCP + 400 ms', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const figureChunks = chunksContaining(JS_DIR, '.js', MARKER);
    expect(figureChunks.length).toBeGreaterThan(0);
    await installPerfProbe(page);

    const scripts: string[] = [];
    page.on('response', (res) => {
      if (res.request().resourceType() === 'script') scripts.push(new URL(res.url()).pathname);
    });
    const response = await page.goto('/login');
    const html = (await response?.text()) ?? '';
    const initial = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (m) => new URL(m[1] ?? '', 'http://x').pathname,
    );
    expect(initial.length, 'scripts no HTML').toBeGreaterThan(3);
    for (const chunk of figureChunks) {
      expect(initial, `chunk da figura nos scripts do HTML: ${chunk.url}`).not.toContain(chunk.url);
    }
    // Nem a referência por nome: o HTML não pré-carrega o chunk (preload/prefetch).
    for (const chunk of figureChunks) {
      expect(
        html.includes(path.basename(chunk.url)),
        `HTML referencia ${path.basename(chunk.url)}`,
      ).toBe(false);
    }

    await expect(page.locator(ARMED)).toHaveCount(1, { timeout: 15_000 });
    for (const chunk of figureChunks) {
      expect(scripts, 'o chunk da figura carregou depois').toContain(chunk.url);
    }

    const timing = await page.evaluate(
      (urls) => {
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1;
        const starts = urls.map((u) => {
          const entry = performance
            .getEntriesByType('resource')
            .find((r) => new URL(r.name).pathname === u);
          return { url: u, start: entry ? Math.round(entry.startTime) : -1 };
        });
        return { fcp: Math.round(fcp), starts };
      },
      figureChunks.map((c) => c.url),
    );
    console.log(`LAZY ${JSON.stringify(timing)}`);
    test.info().annotations.push({ type: 'lazy', description: JSON.stringify(timing) });
    expect(timing.fcp).toBeGreaterThan(0);
    for (const s of timing.starts) {
      expect(
        s.start,
        `${s.url} pedido antes de FCP + 400 ms (FCP ${timing.fcp})`,
      ).toBeGreaterThanOrEqual(timing.fcp + 400 - 25);
    }
  });
});

/* ----------------------------------------------------------------------------------- */
/* 3-4. LCP e CLS                                                                       */
/* ----------------------------------------------------------------------------------- */

for (const size of [
  { name: 'desktop 1440', width: 1440, height: 900 },
  { name: 'celular 375', width: 375, height: 812 },
] as const) {
  test.describe(`Companheiro — LCP e CLS (${size.name})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('o LCP nunca é o companheiro e a soma de layout-shift fica abaixo de 0,01', async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await installPerfProbe(page);
      await openLogin(page);
      // Interage como a pessoa: foco (voo no desktop), senha (avert), volta.
      await page.getByLabel('Email').focus();
      await page.waitForTimeout(900);
      await page.getByLabel('Senha').focus();
      await page.waitForTimeout(600);
      await page.getByLabel('Email').focus();
      await page.waitForTimeout(2_500);

      const probe = await perfOf(page);
      const cls = sumCls(probe);
      const last = probe.lcp[probe.lcp.length - 1];
      console.log(
        `LCP+CLS ${size.name} ${JSON.stringify({ lcp: probe.lcp, cls, shifts: probe.cls })}`,
      );
      test.info().annotations.push({
        type: `lcp-cls-${size.width}`,
        description: JSON.stringify({ lcp: last, cls, shifts: probe.cls }),
      });
      expect(last, 'sem entrada de LCP').toBeDefined();
      expect(
        probe.lcp.filter((e) => e.inCompanion),
        'LCP dentro do companheiro',
      ).toEqual([]);
      expect(cls, `CLS ${cls.toFixed(5)}: ${JSON.stringify(probe.cls)}`).toBeLessThan(0.01);
    });

    test('o companheiro não acrescenta deslocamento ao fluxo cadastro -> enviado', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const run = async (
        noCompanion: boolean,
      ): Promise<{ cls: number; shifts: PerfProbe['cls'] }> => {
        await page.context().clearCookies();
        await installPerfProbe(page, { noCompanion });
        await page.route('**/auth/signup', (route) =>
          route.fulfill({
            status: 202,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'verification_sent' }),
          }),
        );
        await page.goto('/signup');
        await waitForHydration(page.getByRole('button', { name: 'Criar conta', exact: true }));
        if (!noCompanion) await expect(page.locator(ARMED)).toHaveCount(1, { timeout: 15_000 });
        else await page.waitForTimeout(2_000);
        await page.getByLabel('Seu nome').focus();
        await page.getByLabel('Seu nome').fill('Ana Souza');
        await page.getByLabel('Email').fill('ana@aurora.test');
        await page.getByLabel('Nome do workspace').fill('Clínica Aurora');
        await page.getByLabel('Senha').fill('senha-forte-123');
        await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
        // O clique conta como input recente (exclui shifts de 500 ms); o resto do fluxo conta.
        await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Verifique seu email', exact: true }),
        ).toBeVisible();
        await page.waitForTimeout(3_500);
        const probe = await perfOf(page);
        return { cls: sumCls(probe), shifts: probe.cls };
      };

      const withCompanion = await run(false);
      await page.unroute('**/auth/signup');
      const baseline = await run(true);
      console.log(`CLS-FLUXO ${size.name} ${JSON.stringify({ withCompanion, baseline })}`);
      test.info().annotations.push({
        type: `cls-fluxo-${size.width}`,
        description: JSON.stringify({ withCompanion: withCompanion.cls, baseline: baseline.cls }),
      });
      expect(withCompanion.cls - baseline.cls, 'o companheiro acrescenta CLS').toBeLessThan(0.001);
      expect(
        withCompanion.cls,
        `CLS do fluxo ${JSON.stringify(withCompanion.shifts)}`,
      ).toBeLessThan(0.01);
    });
  });
}

/* ----------------------------------------------------------------------------------- */
/* 5. OCIOSIDADE                                                                        */
/* ----------------------------------------------------------------------------------- */

test.describe('Companheiro — ociosidade (1440)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('15 s parado: só o piscar (ou nada) roda; respiração limitada a 3 ciclos', async ({
    page,
  }) => {
    test.setTimeout(75_000);
    await installPerfProbe(page);
    await openLogin(page);
    // Entrada concluída (320 ms) antes de contar os 15 s.
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (a) =>
            a.playState !== 'running' ||
            Number(a.effect?.getTiming().duration ?? 0) >= 4000 ||
            a.effect?.getTiming().iterations === Infinity,
        ),
    );

    const early = await runningAnimations(page);
    console.log(`OCIO início ${JSON.stringify(early)}`);
    expect(
      early.some((a) => a.startsWith('companheiro:fig:x3:4200ms')),
      `a respiração (3 x 4,2 s) deveria estar rodando logo após a entrada: ${JSON.stringify(early)}`,
    ).toBe(true);

    await page.waitForTimeout(15_000);
    const samples: string[][] = [];
    for (let i = 0; i < 6; i += 1) {
      samples.push(await runningAnimations(page));
      await page.waitForTimeout(700);
    }
    console.log(`OCIO após 15 s ${JSON.stringify(samples)}`);
    for (const sample of samples) {
      for (const anim of sample) {
        expect(anim, `animação rodando após 15 s parado: ${JSON.stringify(sample)}`).toMatch(
          /^companheiro:eyes-open:/,
        );
      }
    }
    // Nada infinito no documento, nunca.
    expect(samples.flat().filter((a) => a.includes('xInfinity'))).toEqual([]);
  });

  test('aba oculta: 0 animações rodando; ao voltar, retoma', async ({ page }) => {
    test.setTimeout(60_000);
    await installPerfProbe(page);
    await openLogin(page);
    await page.waitForTimeout(500);
    const before = (await runningAnimations(page)).filter((a) => a.startsWith('companheiro:'));
    expect(before.length, 'sem animação para pausar (teste vazio)').toBeGreaterThan(0);

    await setHidden(page, true);
    await page.waitForTimeout(400);
    const hidden = (await runningAnimations(page)).filter((a) => a.startsWith('companheiro:'));
    expect(hidden, 'animações rodando com a aba oculta').toEqual([]);

    await setHidden(page, false);
    await page.waitForTimeout(400);
    const back = (await runningAnimations(page)).filter((a) => a.startsWith('companheiro:'));
    expect(back.length, 'retoma ao voltar').toBeGreaterThan(0);
  });

  test('fora da viewport: 0 animações rodando; ao voltar, retoma', async ({ page }) => {
    test.setTimeout(60_000);
    await installPerfProbe(page);
    await openLogin(page);
    await page.waitForTimeout(500);
    const before = (await runningAnimations(page)).filter((a) => a.startsWith('companheiro:'));
    expect(before.length, 'sem animação para pausar (teste vazio)').toBeGreaterThan(0);

    // Viewport baixa + rolagem: a figura (no topo da coluna) sai da tela.
    await page.setViewportSize({ width: 1440, height: 160 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const r = document.querySelector('[data-companion]')?.getBoundingClientRect();
          return r ? r.bottom < 0 || r.top > window.innerHeight : false;
        }),
      )
      .toBe(true);
    await page.waitForTimeout(500);
    const away = (await runningAnimations(page)).filter((a) => a.startsWith('companheiro:'));
    expect(away, 'animações rodando fora da viewport').toEqual([]);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    const back = (await runningAnimations(page)).filter((a) => a.startsWith('companheiro:'));
    expect(back.length, 'retoma ao voltar para a viewport').toBeGreaterThan(0);
  });

  test('movimento reduzido: sem voo, sem respiração, sem piscar (nada roda em 8 s)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installPerfProbe(page);
    await openLogin(page);
    await expect(page.locator('[data-companion]')).toHaveAttribute('data-motion', 'off');
    await page.getByLabel('Email').focus();
    await page.getByLabel('Senha').focus();
    const samples: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await page.waitForTimeout(1_000);
      samples.push(...(await runningAnimations(page)).filter((a) => a.startsWith('companheiro:')));
      // Depois do crossfade de entrada (160 ms) não pode haver nada rodando.
    }
    expect(samples, 'animações do companheiro com movimento reduzido').toEqual([]);
    const probe = await perfOf(page);
    const moving = probe.animations.filter(
      (a) => a.props.includes('transform') || a.props.includes('translate'),
    );
    expect(moving, `animações de transform criadas: ${JSON.stringify(moving)}`).toEqual([]);
    for (const a of probe.animations) expect(a.duration).toBeLessThanOrEqual(160);
  });
});
