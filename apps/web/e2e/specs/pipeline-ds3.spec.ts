/**
 * F72-S06 — Pipeline no DS 3.0 (maquete "Pipeline"): colunas com cabeçalho em mono,
 * card com valor em mono e tempo na etapa, drag com resposta imediata e soltar com
 * State morph, e o movimento SEM arrastar (WCAG 2.1.1 / 2.5.7): Shift + ←/→ no card e
 * o menu "Mover para etapa". Nos dois temas, em 1440 e 375 (board mobile = seletor de
 * etapa; o funil está no "Mais").
 *
 * Rede 100% mockada (fixture automática + rotas locais abaixo, que vencem o fallback).
 * Contraste por cálculo WCAG sobre a cor computada (mesma linha da S04/S05). O axe roda
 * se o `axe-core` estiver no store do pnpm (o repo não depende dele diretamente).
 *
 * Capturas em `e2e/.artifacts/f72-s06/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, Request, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';

// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

const SHOTS = 'e2e/.artifacts/f72-s06';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const PIPELINE = {
  id: 'pipe_ds3',
  name: 'Reformas',
  description: null,
  industry: 'generic',
  isDefault: true,
  isActive: true,
  settings: { custom_fields: [] as unknown[] },
};

function stage(id: string, name: string, position: number, color: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    pipelineId: PIPELINE.id,
    name,
    color,
    icon: null,
    position,
    isWon: false,
    isLost: false,
    probability: null,
    automationRules: [] as unknown[],
    transitionRules: {},
    ...extra,
  };
}

// "Ganho" só aceita quem vem de "Orçamento": o menu mostra "Bloqueada" para quem está em "Qualificado".
const STAGES = [
  stage('st_qualified', 'Qualificado', 0, 'var(--info)'),
  stage('st_estimate', 'Orçamento', 1, 'var(--warn)'),
  stage('st_won', 'Ganho', 2, 'var(--success)', {
    isWon: true,
    transitionRules: { allowedFromStageIds: ['st_estimate'] },
  }),
];

interface MockDeal {
  id: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  title: string;
  valueCents: number;
  currency: string;
  ownerId: string | null;
  position: number;
  customFields: Record<string, unknown>;
  closedAt: string | null;
  closedWon: boolean | null;
  createdAt: string;
  updatedAt: string | null;
}

function deal(id: string, stageId: string, title: string, valueCents: number, ageMs: number): MockDeal {
  const at = new Date(Date.now() - ageMs).toISOString();
  return {
    id,
    pipelineId: PIPELINE.id,
    stageId,
    contactId: `ct_${id}`,
    title,
    valueCents,
    currency: 'BRL',
    ownerId: null,
    position: 0,
    customFields: {},
    closedAt: null,
    closedWon: null,
    createdAt: at,
    updatedAt: at,
  };
}

const json = (route: Route, body: unknown, status = 200): Promise<void> =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function parseBody(request: Request): Record<string, unknown> {
  try {
    return JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface InstallOptions {
  /** O move-stage responde 500 (rollback do otimista + toast de erro). */
  readonly failMoves?: boolean;
}

async function install(
  page: Page,
  { failMoves = false }: InstallOptions = {},
): Promise<{ deals: MockDeal[]; moves: { dealId: string; stageId: string }[] }> {
  const deals: MockDeal[] = [
    deal('d_kitchen', 'st_qualified', 'Cozinha · Maria S.', 1_840_000, 3 * DAY),
    deal('d_roof', 'st_qualified', 'Telhado · Carlos R.', 1_200_000, 9 * DAY),
    deal('d_bath', 'st_estimate', 'Banheiro · João L.', 980_000, 5 * HOUR),
    deal('d_remodel', 'st_won', 'Reforma completa · Mike B.', 3_150_000, 16 * DAY),
  ];
  const moves: { dealId: string; stageId: string }[] = [];

  await page.route(/\/api\/pipelines$/, (route) =>
    route.request().method() === 'GET'
      ? json(route, { data: [PIPELINE], meta: { limit: 3, current: 1 } })
      : route.fallback(),
  );
  await page.route(/\/api\/pipelines\/[^/?]+$/, (route) =>
    route.request().method() === 'GET' ? json(route, { pipeline: PIPELINE, stages: STAGES }) : route.fallback(),
  );
  await page.route(/\/api\/deals(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { deals }) : route.fallback(),
  );
  await page.route(/\/api\/deals\/[^/]+\/move-stage$/, (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const dealId = new URL(request.url()).pathname.split('/').slice(-2)[0] ?? '';
    const body = parseBody(request);
    const stageId = typeof body['stageId'] === 'string' ? body['stageId'] : '';
    moves.push({ dealId, stageId });
    if (failMoves) return json(route, { message: 'Não foi possível mover agora.' }, 500);
    const d = deals.find((x) => x.id === dealId);
    if (d && stageId) {
      // Espelho de `deal-move.ts`: o deal movido vai para o topo da etapa (position 0).
      d.stageId = stageId;
      d.position = 0;
      d.updatedAt = new Date().toISOString();
    }
    return json(route, { deal: d ?? { id: dealId, stageId } });
  });
  return { deals, moves };
}

const column = (page: Page, stageId: string): Locator => page.locator(`section[data-stage-id="${stageId}"]`);
/** Ids dos cards de uma coluna, na ordem exibida. */
const columnOrder = (page: Page, stageId: string): Promise<string[]> =>
  column(page, stageId)
    .locator('[data-deal-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-deal-id') ?? ''));
const card = (page: Page, dealId: string): Locator => page.locator(`[data-deal-id="${dealId}"] > [role="button"]`);

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * Menor contraste (WCAG) do texto visível dentro de `selector`, com o fundo composto
 * pelas camadas translúcidas dos ancestrais até a primeira opaca (ou `--bg`).
 */
async function minContrast(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'transparent';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
    };
    const channel = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: number[]): number =>
      0.2126 * channel(c[0] ?? 0) + 0.7152 * channel(c[1] ?? 0) + 0.0722 * channel(c[2] ?? 0);
    const probe = document.createElement('span');
    probe.style.color = 'var(--bg)';
    document.body.appendChild(probe);
    const pageBg = rgba(getComputedStyle(probe).color);
    probe.remove();
    const backdrop = (el: Element): number[] => {
      const layers: [number, number, number, number][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = rgba(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let out: number[] = [pageBg[0], pageBg[1], pageBg[2]];
      for (const [r, g, b, a] of layers.reverse()) {
        out = [r * a + (out[0] ?? 0) * (1 - a), g * a + (out[1] ?? 0) * (1 - a), b * a + (out[2] ?? 0) * (1 - a)];
      }
      return out;
    };
    let min = Infinity;
    for (const root of Array.from(document.querySelectorAll(sel))) {
      for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
        const ownText = Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        if (!ownText || el.closest('.sr-only') || el.getClientRects().length === 0) continue;
        const fg = lum(rgba(getComputedStyle(el).color));
        const bg = lum(backdrop(el));
        const [hi, lo] = [fg, bg].sort((a, b) => b - a);
        min = Math.min(min, ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05));
      }
    }
    return min;
  }, selector);
}

function findAxe(): string | null {
  const store = path.resolve(process.cwd(), '../../node_modules/.pnpm');
  if (!fs.existsSync(store)) return null;
  const dir = fs.readdirSync(store).find((d) => d.startsWith('axe-core@'));
  if (!dir) return null;
  const file = path.join(store, dir, 'node_modules/axe-core/axe.min.js');
  return fs.existsSync(file) ? file : null;
}

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: string[];
}

async function axeViolations(page: Page, axePath: string): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    interface AxeResult {
      violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[];
    }
    const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<AxeResult> } };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
  });
}

async function expectNoSeriousAxe(page: Page): Promise<void> {
  const axe = findAxe();
  test.skip(axe === null, 'axe-core não está no store do pnpm (o repo não depende dele)');
  const violations = await axeViolations(page, axe as string);
  expect(violations.filter((v) => v.id === 'nested-interactive')).toEqual([]);
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Pipeline DS 3.0 — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(90_000);
      await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
    });

    test.describe('desktop 1440', () => {
      test.use({ viewport: { width: 1440, height: 900 } });

      test('colunas em mono com contagem; card com valor em mono e tempo na etapa', async ({ page }) => {
        await install(page);
        await page.goto('/pipeline');
        const qualified = column(page, 'st_qualified');
        await expect(qualified.getByRole('heading', { level: 3, name: 'Qualificado' })).toBeVisible();
        await expect(qualified.locator('header')).toContainText('2');
        // Cabeçalho da coluna e valor: família mono do DS.
        const headFont = await qualified.getByRole('heading', { level: 3 }).evaluate((el) => getComputedStyle(el).fontFamily);
        expect(headFont).toMatch(/mono/i);
        const kitchen = card(page, 'd_kitchen');
        const value = kitchen.getByText(/R\$\s?18\.400,00/);
        await expect(value).toBeVisible();
        expect(await value.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
        // Tempo na etapa: compacto à vista, extenso para leitor de tela; parado ≥7d vira alerta.
        await expect(kitchen).toContainText('3d');
        await expect(kitchen.locator('.sr-only')).toContainText('na etapa há 3 dias');
        await expect(card(page, 'd_roof')).toContainText('9d');
        await expect(card(page, 'd_remodel')).toContainText('2sem');
        await expect(card(page, 'd_bath')).toContainText('5h');
      });

      test('sem controle aninhado: o botão de mover é irmão do card, não filho', async ({ page }) => {
        await install(page);
        await page.goto('/pipeline');
        await expect(card(page, 'd_kitchen')).toBeVisible();
        await expect(
          page.locator(
            '[data-deal-id] > [role="button"] :is(a, button, input, select, textarea, [tabindex], [role="button"], [role="menuitem"])',
          ),
        ).toHaveCount(0);
        await expect(page.locator('[data-deal-id="d_kitchen"] > button[aria-haspopup="menu"]')).toHaveCount(1);
      });

      test('teclado: Shift + → move para a etapa vizinha, anuncia e mantém o foco no card', async ({ page }) => {
        const ctx = await install(page);
        await page.goto('/pipeline');
        await settle(page);
        await card(page, 'd_kitchen').focus();
        await page.keyboard.press('Shift+ArrowRight');
        await expect.poll(() => ctx.moves.at(-1)).toEqual({ dealId: 'd_kitchen', stageId: 'st_estimate' });
        // O card remonta na coluna nova e o foco vai junto.
        await expect(column(page, 'st_estimate').locator('[data-deal-id="d_kitchen"] > [role="button"]')).toBeFocused();
        await expect(page.getByRole('status').filter({ hasText: 'movido para a etapa "Orçamento"' })).toHaveCount(1);
        // Tempo na etapa zera com o movimento (update otimista).
        await expect(card(page, 'd_kitchen')).toContainText('<1h');
        // Shift + ← volta.
        await page.keyboard.press('Shift+ArrowLeft');
        await expect.poll(() => ctx.moves.at(-1)).toEqual({ dealId: 'd_kitchen', stageId: 'st_qualified' });
        await expect(column(page, 'st_qualified').locator('[data-deal-id="d_kitchen"] > [role="button"]')).toBeFocused();
      });

      test('teclado: Shift + → respeita a regra de transição (Ganho só a partir de Orçamento)', async ({ page }) => {
        const ctx = await install(page);
        await page.goto('/pipeline');
        await settle(page);
        // Em "Orçamento", a vizinha "Ganho" aceita.
        await card(page, 'd_bath').focus();
        await page.keyboard.press('Shift+ArrowRight');
        await expect.poll(() => ctx.moves.at(-1)).toEqual({ dealId: 'd_bath', stageId: 'st_won' });
        // Na última etapa não há para onde ir: nada é enviado, a região viva explica.
        const before = ctx.moves.length;
        await expect(column(page, 'st_won').locator('[data-deal-id="d_bath"] > [role="button"]')).toBeFocused();
        await page.keyboard.press('Shift+ArrowRight');
        // (o dnd-kit tem a sua própria região `status`; filtra pela nossa mensagem)
        await expect(page.getByRole('status').filter({ hasText: 'última etapa' })).toHaveCount(1);
        expect(ctx.moves.length).toBe(before);
      });

      test('menu "Mover para etapa": teclado ponta a ponta, atual e bloqueada desabilitadas', async ({ page }) => {
        const ctx = await install(page);
        await page.goto('/pipeline');
        await settle(page);
        const trigger = page.getByRole('button', { name: 'Mover "Cozinha · Maria S." para outra etapa' });
        await trigger.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu', { name: /Mover "Cozinha · Maria S\." para a etapa/ });
        await expect(menu).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(menu.getByRole('menuitem', { name: /Qualificado/ })).toHaveAttribute('aria-disabled', 'true');
        await expect(menu.getByRole('menuitem', { name: /Ganho/ })).toHaveAttribute('aria-disabled', 'true');
        // Foco entra no primeiro destino válido; ↓ pula os desabilitados e dá a volta nele mesmo.
        const estimate = menu.getByRole('menuitem', { name: /Orçamento/ });
        await expect(estimate).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(estimate).toBeFocused();
        // Esc fecha e devolve o foco ao botão.
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();
        // Reabre e escolhe com Enter.
        await page.keyboard.press('Enter');
        await expect(estimate).toBeFocused();
        await page.keyboard.press('Enter');
        await expect.poll(() => ctx.moves.at(-1)).toEqual({ dealId: 'd_kitchen', stageId: 'st_estimate' });
        await expect(menu).toHaveCount(0);
        await expect(column(page, 'st_estimate').locator('[data-deal-id="d_kitchen"]')).toHaveCount(1);
      });

      test('arrastar: card no ar na hora (<200ms), soltar move e assenta com State morph', async ({ page }) => {
        const ctx = await install(page);
        await page.goto('/pipeline');
        await settle(page);
        const from = await card(page, 'd_kitchen').boundingBox();
        const to = await column(page, 'st_estimate').locator('div.overflow-y-auto').boundingBox();
        if (!from || !to) throw new Error('layout do board não mediu');
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        // Passa da distância de ativação (6px): o card sobe para o overlay (o tempo é medido no teste abaixo).
        await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 4, { steps: 2 });
        await expect(page.locator('[data-lifted]')).toHaveCount(1);
        // Origem vira o vazio tracejado enquanto o card viaja.
        await expect(card(page, 'd_kitchen').locator('.border-dashed')).toHaveCount(1);
        await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 8 });
        // Multi-container: o placeholder JÁ está na coluna sob o cursor antes de soltar —
        // é para ele que o overlay anima (e não de volta à origem).
        await expect(column(page, 'st_estimate').locator('[data-deal-id="d_kitchen"]')).toHaveCount(1);
        await expect(column(page, 'st_qualified').locator('[data-deal-id="d_kitchen"]')).toHaveCount(0);
        await page.mouse.up();
        await expect.poll(() => ctx.moves.at(-1)).toEqual({ dealId: 'd_kitchen', stageId: 'st_estimate' });
        // Sem volta à origem no intervalo até o update otimista.
        await expect(column(page, 'st_qualified').locator('[data-deal-id="d_kitchen"]')).toHaveCount(0);
        // Ao assentar vale a ordem do SERVIDOR (position asc, createdAt desc), não a do cursor:
        // o card foi solto acima de "Banheiro", mas é mais antigo — fica abaixo, e o refetch
        // confirma a mesma ordem (nenhum salto depois).
        await expect.poll(() => columnOrder(page, 'st_estimate')).toEqual(['d_bath', 'd_kitchen']);
        await settle(page);
        expect(await columnOrder(page, 'st_estimate')).toEqual(['d_bath', 'd_kitchen']);
        // State morph: chega aceso (borda de marca) e volta ao repouso.
        await expect(column(page, 'st_estimate').locator('[data-deal-id="d_kitchen"] [data-settled]')).toHaveCount(1);
        await expect(page.locator('[data-settled]')).toHaveCount(0, { timeout: 3000 });
      });

      test('arrastar: move-stage com 500 devolve o card à origem e avisa com toast de erro', async ({ page }) => {
        const ctx = await install(page, { failMoves: true });
        await page.goto('/pipeline');
        await settle(page);
        const from = await card(page, 'd_kitchen').boundingBox();
        const to = await column(page, 'st_estimate').locator('div.overflow-y-auto').boundingBox();
        if (!from || !to) throw new Error('layout do board não mediu');
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 4, { steps: 2 });
        await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 8 });
        await expect(column(page, 'st_estimate').locator('[data-deal-id="d_kitchen"]')).toHaveCount(1);
        await page.mouse.up();
        await expect.poll(() => ctx.moves.at(-1)).toEqual({ dealId: 'd_kitchen', stageId: 'st_estimate' });
        // Rollback: volta à etapa e à posição de origem (ordem do servidor), e o erro é anunciado.
        await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível mover agora.' })).toBeVisible();
        await expect(column(page, 'st_estimate').locator('[data-deal-id="d_kitchen"]')).toHaveCount(0);
        await expect.poll(() => columnOrder(page, 'st_qualified')).toEqual(['d_kitchen', 'd_roof']);
        await expect(page.locator('[data-settled]')).toHaveCount(0);
      });

      test('arrastar: coluna que a regra recusa não recebe o placeholder; Esc devolve à origem', async ({ page }) => {
        const ctx = await install(page);
        await page.goto('/pipeline');
        await settle(page);
        const movesBefore = ctx.moves.length;
        const from = await card(page, 'd_kitchen').boundingBox();
        const won = await column(page, 'st_won').locator('div.overflow-y-auto').boundingBox();
        const estimate = await column(page, 'st_estimate').locator('div.overflow-y-auto').boundingBox();
        if (!from || !won || !estimate) throw new Error('layout do board não mediu');
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 4, { steps: 2 });
        // "Ganho" só aceita vindo de "Orçamento": o placeholder não entra lá.
        await page.mouse.move(won.x + won.width / 2, won.y + 40, { steps: 10 });
        await expect(column(page, 'st_won').locator('[data-deal-id="d_kitchen"]')).toHaveCount(0);
        await page.mouse.up();
        await expect(column(page, 'st_qualified').locator('[data-deal-id="d_kitchen"]')).toHaveCount(1);
        expect(ctx.moves.length).toBe(movesBefore);

        // Esc no meio do arrasto: o placeholder que já tinha viajado volta à origem.
        const again = await card(page, 'd_kitchen').boundingBox();
        if (!again) throw new Error('card sumiu');
        await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
        await page.mouse.down();
        await page.mouse.move(again.x + again.width / 2 + 12, again.y + again.height / 2 + 4, { steps: 2 });
        await page.mouse.move(estimate.x + estimate.width / 2, estimate.y + 40, { steps: 8 });
        await expect(column(page, 'st_estimate').locator('[data-deal-id="d_kitchen"]')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(column(page, 'st_qualified').locator('[data-deal-id="d_kitchen"]')).toHaveCount(1);
        await expect(column(page, 'st_estimate').locator('[data-deal-id="d_kitchen"]')).toHaveCount(0);
        expect(ctx.moves.length).toBe(movesBefore);
      });

      test('feedback do drag em <200ms: overlay aparece no primeiro frame após passar 6px', async ({ page }) => {
        await install(page);
        await page.goto('/pipeline');
        await settle(page);
        const from = await card(page, 'd_bath').boundingBox();
        if (!from) throw new Error('card não mediu');
        const x = from.x + from.width / 2;
        const y = from.y + from.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        // Marca o instante do pointermove que ativa o drag e o primeiro frame com o overlay.
        await page.evaluate(() => {
          const w = window as unknown as { __liftMs?: number };
          let t0 = 0;
          window.addEventListener('pointermove', () => (t0 ||= performance.now()), { capture: true });
          const obs = new MutationObserver(() => {
            if (t0 && w.__liftMs === undefined && document.querySelector('[data-lifted]')) {
              w.__liftMs = performance.now() - t0;
              obs.disconnect();
            }
          });
          obs.observe(document.body, { childList: true, subtree: true, attributes: true });
        });
        await page.mouse.move(x + 20, y + 4, { steps: 1 });
        await expect(page.locator('[data-lifted]')).toHaveCount(1);
        const liftMs = await page.evaluate(() => (window as unknown as { __liftMs?: number }).__liftMs ?? Infinity);
        expect(liftMs, `overlay em ${liftMs.toFixed(1)}ms`).toBeLessThan(200);
        await page.keyboard.press('Escape');
        await page.mouse.up();
      });

      test('reduced-motion: nada se desloca (sem transição de transform no card)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await install(page);
        await page.goto('/pipeline');
        await settle(page);
        const view = card(page, 'd_kitchen').locator(':scope > div').first();
        await card(page, 'd_kitchen').hover();
        const s = await view.evaluate((el) => {
          const c = getComputedStyle(el);
          return { transform: c.transform, property: c.transitionProperty };
        });
        expect(s.transform === 'none' || s.transform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
        expect(s.property).toBe('none');
        // Nenhuma animação contínua no board.
        const infinite = await page.evaluate(
          () => document.getAnimations().filter((a) => a.effect?.getTiming().iterations === Infinity).length,
        );
        expect(infinite).toBe(0);
      });

      test('contraste ≥ 4,5:1 no board, no menu e nas configurações', async ({ page }) => {
        await install(page);
        await page.goto('/pipeline');
        await expect(card(page, 'd_kitchen')).toBeVisible();
        await settle(page);
        const board = await minContrast(page, '[data-tour-id="pipeline-board"]');
        expect(board, `board (${theme})`).toBeGreaterThanOrEqual(4.5);
        await page.getByRole('button', { name: 'Mover "Telhado · Carlos R." para outra etapa' }).click();
        await expect(page.getByRole('menu')).toBeVisible();
        const menu = await minContrast(page, '[role="menu"]');
        expect(menu, `menu (${theme})`).toBeGreaterThanOrEqual(4.5);
        await page.keyboard.press('Escape');

        await page.goto('/pipeline/settings');
        await expect(page.getByRole('heading', { name: 'Configurar pipeline' })).toBeVisible();
        await settle(page);
        const settings = await minContrast(page, 'main');
        expect(settings, `configurações (${theme})`).toBeGreaterThanOrEqual(4.5);
        console.log(
          `[f72-s06] contraste pipeline ${theme}: board ${board.toFixed(2)} · menu ${menu.toFixed(2)} · ` +
            `configurações ${settings.toFixed(2)}`,
        );
      });

      test('configurações: estágios com alvos ≥24px e remoção com confirmação', async ({ page }) => {
        await install(page);
        await page.goto('/pipeline/settings');
        await expect(page.getByRole('heading', { name: 'Configurar pipeline' })).toBeVisible();
        const up = page.getByRole('button', { name: 'Mover Orçamento para cima' });
        const box = await up.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
        await page.getByRole('button', { name: 'Remover estágio Orçamento' }).click();
        const confirm = page.getByRole('group', { name: 'Confirmar remoção de Orçamento' });
        await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: 'Voltar' }).click();
        await expect(confirm).toHaveCount(0);
      });

      test('axe (se disponível): board e configurações sem violação séria', async ({ page }) => {
        await install(page);
        await page.goto('/pipeline');
        await expect(card(page, 'd_kitchen')).toBeVisible();
        await expectNoSeriousAxe(page);
        await page.goto('/pipeline/settings');
        await expect(page.getByRole('heading', { name: 'Configurar pipeline' })).toBeVisible();
        await expectNoSeriousAxe(page);
      });

      test('capturas 1440', async ({ page }) => {
        await install(page);
        await page.goto('/pipeline');
        await expect(card(page, 'd_kitchen')).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-1-board.png`, animations: 'disabled' });
        await page.getByRole('button', { name: 'Mover "Cozinha · Maria S." para outra etapa' }).click();
        await expect(page.getByRole('menu')).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-2-mover-para.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
        await page.goto('/pipeline/settings');
        await expect(page.getByRole('heading', { name: 'Configurar pipeline' })).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-3-configuracoes.png`, animations: 'disabled' });
      });
    });

    test.describe('mobile 375', () => {
      test.use({ viewport: { width: 375, height: 812 } });

      test('seletor de etapa, card com valor em mono e mover por ação; capturas', async ({ page }) => {
        const ctx = await install(page);
        await page.goto('/pipeline');
        const tabs = page.getByRole('tablist', { name: 'Estágios da pipeline' });
        await expect(tabs).toBeVisible();
        await expect(tabs.getByRole('tab', { name: /Qualificado/ })).toHaveAttribute('aria-selected', 'true');
        const value = page.getByText(/R\$\s?18\.400,00/);
        await expect(value).toBeVisible();
        expect(await value.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/375-${theme}-1-board.png`, animations: 'disabled' });

        await page.getByRole('button', { name: 'Mover "Cozinha · Maria S." para outro estágio' }).click();
        const sheet = page.getByRole('dialog', { name: 'Mover para' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('button', { name: /Ganho/ })).toBeDisabled();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/375-${theme}-2-mover-para.png`, animations: 'disabled' });
        await sheet.getByRole('button', { name: /Orçamento/ }).click();
        await expect.poll(() => ctx.moves.at(-1)).toEqual({ dealId: 'd_kitchen', stageId: 'st_estimate' });
      });

      test('contraste e axe 375 (se disponível)', async ({ page }) => {
        await install(page);
        await page.goto('/pipeline');
        await expect(page.getByRole('tablist', { name: 'Estágios da pipeline' })).toBeVisible();
        await settle(page);
        const min = await minContrast(page, 'main');
        expect(min, `board mobile (${theme})`).toBeGreaterThanOrEqual(4.5);
        await expectNoSeriousAxe(page);
      });
    });
  });
}
