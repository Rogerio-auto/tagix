/**
 * F72-S06 — Calendário unificado no DS 3.0 (maquete "Unified calendar"): visões dia,
 * semana e lista; evento colorido pelo TIPO com tom de token (a mesma tabela na grade,
 * na lista, na agenda mobile e no cockpit); "agora" como ÚNICO movimento contínuo
 * (parado sob reduced-motion); detalhe em drawer; mobile na aba Agenda (375).
 *
 * Rede 100% mockada (fixture automática + rotas locais, que vencem o fallback). Os
 * eventos caem no "hoje" de São Paulo (o fuso do navegador de teste), de 00:05 a 23:50,
 * então a linha "agora" sempre tem evento antes e depois.
 *
 * Contraste por cálculo WCAG sobre a cor computada; axe se `axe-core` estiver no store.
 * Evento CONCLUÍDO recua por cor (nunca por opacidade, que o cálculo sobre a cor computada
 * não enxerga): o teste confere opacidade efetiva 1 e contraste ≥4,5:1 nele.
 * Capturas em `e2e/.artifacts/f72-s06/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { ME } from '../fixtures/seed';

// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

const SHOTS = 'e2e/.artifacts/f72-s06';
const HOUR = 3_600_000;

const CAL = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Equipe de obras',
  type: 'workspace',
  color: 'var(--info)',
};

/** "Hoje" em São Paulo (UTC-3 fixo desde 2019) como `YYYY-MM-DD`. */
function spToday(): string {
  return new Date(Date.now() - 3 * HOUR).toISOString().slice(0, 10);
}

/** Horário local de São Paulo hoje → ISO com offset explícito. */
const at = (hhmm: string): string => new Date(`${spToday()}T${hhmm}:00-03:00`).toISOString();

interface Seed {
  id: string;
  title: string;
  type: string;
  start: string;
  end: string;
  tone: string;
  status?: 'scheduled' | 'completed';
}

const COMPLETED_TITLE = 'Visita técnica feita';

const SEEDS: Seed[] = [
  { id: 'e0000000-0000-4000-8000-000000000001', title: 'Café com Maria', type: 'meeting', start: '00:05', end: '00:35', tone: 'brand' },
  { id: 'e0000000-0000-4000-8000-000000000007', title: COMPLETED_TITLE, type: 'meeting', start: '07:00', end: '07:45', tone: 'brand', status: 'completed' },
  { id: 'e0000000-0000-4000-8000-000000000002', title: 'Demonstração cozinha', type: 'demo', start: '09:00', end: '10:00', tone: 'violet' },
  { id: 'e0000000-0000-4000-8000-000000000003', title: 'Follow-up João', type: 'follow_up', start: '11:00', end: '11:30', tone: 'info' },
  { id: 'e0000000-0000-4000-8000-000000000004', title: 'Proposta telhado', type: 'proposal', start: '14:00', end: '15:00', tone: 'warn' },
  { id: 'e0000000-0000-4000-8000-000000000005', title: 'Compra de material', type: 'other', start: '16:00', end: '16:30', tone: 'neutral' },
  { id: 'e0000000-0000-4000-8000-000000000006', title: 'Ligação Carlos', type: 'call', start: '23:20', end: '23:50', tone: 'brand' },
];

function eventRow(s: Seed) {
  return {
    id: s.id,
    workspaceId: ME.workspace.id,
    calendarId: CAL.id,
    title: s.title,
    description: null,
    type: s.type,
    startAt: at(s.start),
    endAt: at(s.end),
    status: s.status ?? 'scheduled',
    priority: 'medium',
    location: null,
    meetingUrl: null,
    contactId: null,
    dealId: null,
    conversationId: null,
    createdBy: ME.member.id,
    createdByAgentId: null,
    recurrenceRule: null,
    recurrenceUntil: null,
    recurrenceParentId: null,
    metadata: {},
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: null,
  };
}

const json = (route: Route, body: unknown, status = 200): Promise<void> =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function install(page: Page): Promise<void> {
  await page.route(/\/api\/calendars(\?.*)?$/, (route) =>
    json(route, {
      calendars: [
        {
          ...CAL,
          workspaceId: ME.workspace.id,
          ownerId: null,
          teamId: null,
          description: null,
          // eslint-disable-next-line no-restricted-syntax
          timezone: 'America/Sao_Paulo',
          isDefault: true,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: null,
        },
      ],
    }),
  );
  await page.route(/\/api\/members(\?.*)?$/, (route) =>
    json(route, { members: [{ id: ME.member.id, name: ME.member.name, email: 'owner@dev.local', avatarUrl: null }] }),
  );
  await page.route(/\/api\/events(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { events: SEEDS.map(eventRow) }) : route.fallback(),
  );
  await page.route(/\/api\/events\/[^/?]+$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    const seed = SEEDS.find((s) => s.id === id) ?? SEEDS[1];
    if (!seed) return route.fallback();
    return json(route, {
      event: eventRow(seed),
      participants: [
        {
          id: 'pppppppp-1111-4111-8111-111111111111',
          eventId: seed.id,
          memberId: ME.member.id,
          contactId: null,
          role: 'organizer',
          rsvp: 'accepted',
          notifiedAt: null,
        },
      ],
    });
  });
}

const grid = (page: Page): Locator => page.locator('.hm-calendar');
const viewButton = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'Visão da agenda' }).getByRole('button', { name });

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Animações infinitas dentro do `<main>` (o conteúdo da tela, sem o shell). */
async function infiniteAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    return document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations === Infinity)
      .map((a) => (a.effect instanceof KeyframeEffect ? a.effect : null))
      .filter(
        (e): e is KeyframeEffect & { target: Element } =>
          e !== null && e.target instanceof Element && (main?.contains(e.target) ?? false),
      )
      .map((e) => {
        const name = typeof e.target.className === 'string' ? e.target.className : e.target.tagName;
        return e.pseudoElement ? `${name}${e.pseudoElement}` : name;
      });
  });
}

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

/** Produto das opacidades do elemento e dos ancestrais (opacidade derruba o contraste real). */
async function effectiveOpacity(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  });
}

/** Concluído: sem opacidade, título riscado, contraste AA. Devolve o contraste mínimo. */
async function expectCompletedLegible(page: Page, item: Locator, label: string): Promise<number> {
  await expect(item, label).toBeVisible();
  expect(await effectiveOpacity(item), `${label}: opacidade efetiva`).toBe(1);
  const struck = await item
    .getByText(COMPLETED_TITLE)
    .evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(struck, `${label}: título riscado`).toContain('line-through');
  const min = await minContrast(page, '[data-completed]');
  expect(min, `${label}: contraste`).toBeGreaterThanOrEqual(4.5);
  return min;
}

function findAxe(): string | null {
  const store = path.resolve(process.cwd(), '../../node_modules/.pnpm');
  if (!fs.existsSync(store)) return null;
  const dir = fs.readdirSync(store).find((d) => d.startsWith('axe-core@'));
  if (!dir) return null;
  const file = path.join(store, dir, 'node_modules/axe-core/axe.min.js');
  return fs.existsSync(file) ? file : null;
}

async function expectNoSeriousAxe(page: Page): Promise<void> {
  const axePath = findAxe();
  test.skip(axePath === null, 'axe-core não está no store do pnpm (o repo não depende dele)');
  await page.addScriptTag({ path: axePath as string });
  const violations = await page.evaluate(async () => {
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
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Calendário DS 3.0 — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(90_000);
      await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
      await install(page);
    });

    test.describe('desktop 1440', () => {
      test.use({ viewport: { width: 1440, height: 900 } });

      test('semana: cada evento no tom do seu tipo; legenda de tipos e de calendários', async ({ page }) => {
        await page.goto('/calendar');
        await expect(viewButton(page, 'Semana')).toHaveAttribute('aria-pressed', 'true');
        await expect(grid(page).getByText('Demonstração cozinha')).toBeVisible();
        for (const s of SEEDS) {
          const chip = grid(page).locator('[data-event-tone]').filter({ hasText: s.title });
          await expect(chip, s.title).toHaveAttribute('data-event-tone', s.tone);
        }
        // Cabeçalho do dia e horas em mono.
        const headFont = await grid(page)
          .locator('.fc-col-header-cell-cushion')
          .first()
          .evaluate((el) => getComputedStyle(el).fontFamily);
        expect(headFont).toMatch(/mono/i);
        const legend = page.getByRole('heading', { level: 3, name: 'Tipos' }).locator('..');
        await expect(legend.getByRole('listitem')).toHaveCount(5);
        await expect(page.getByRole('heading', { level: 3, name: 'Calendários' })).toBeVisible();
      });

      test('dia, semana e lista pelo seletor e pelos atalhos 3/2/4', async ({ page }) => {
        await page.goto('/calendar');
        await expect(grid(page).getByText('Demonstração cozinha')).toBeVisible();
        await settle(page);
        await page.keyboard.press('3');
        await expect(viewButton(page, 'Dia')).toHaveAttribute('aria-pressed', 'true');
        await expect(grid(page).locator('.fc-timeGridDay-view')).toHaveCount(1);
        await expect(grid(page).locator('[data-event-tone]')).toHaveCount(SEEDS.length);

        await page.keyboard.press('4');
        await expect(viewButton(page, 'Lista')).toHaveAttribute('aria-pressed', 'true');
        await expect(grid(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Proposta telhado\. Abrir detalhe\./ })).toBeVisible();
        await expect(
          page.getByRole('button', { name: /Proposta telhado\. Abrir detalhe\./ }).locator('[data-event-tone]'),
        ).toHaveAttribute('data-event-tone', 'warn');

        await viewButton(page, 'Semana').click();
        await expect(viewButton(page, 'Semana')).toHaveAttribute('aria-pressed', 'true');
        await expect(grid(page).locator('.fc-timeGridWeek-view')).toHaveCount(1);
      });

      test('"agora" é o único movimento contínuo da tela; parado sob reduced-motion', async ({ page }) => {
        await page.goto('/calendar');
        await expect(grid(page).getByText('Demonstração cozinha')).toBeVisible();
        await settle(page);
        // O ponto é o ::before da linha (a seta nativa, na coluna de horas, some).
        await expect(grid(page).locator('.fc-timegrid-now-indicator-line')).toHaveCount(1);
        await expect(grid(page).locator('.fc-timegrid-now-indicator-arrow')).toBeHidden();
        const live = await infiniteAnimations(page);
        expect(live, live.join(' | ')).toHaveLength(1);
        expect(live[0]).toContain('fc-timegrid-now-indicator-line');
        expect(live[0]).toContain('::before');

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await expect(grid(page).getByText('Demonstração cozinha')).toBeVisible();
        await settle(page);
        expect(await infiniteAnimations(page)).toEqual([]);
      });

      test('clicar no evento abre o detalhe em drawer, com a agenda ao lado', async ({ page }) => {
        await page.goto('/calendar');
        await grid(page).getByText('Follow-up João').click();
        const drawer = page.getByRole('dialog');
        await expect(drawer).toBeVisible();
        await expect(drawer.getByText('Follow-up João').first()).toBeVisible();
        // Drawer lateral: ocupa a borda direita, não a tela inteira.
        const box = await drawer.boundingBox();
        expect(box?.width ?? 1440).toBeLessThan(720);
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
      });

      test('contraste ≥ 4,5:1 na grade, na trilha e na lista', async ({ page }) => {
        await page.goto('/calendar');
        await expect(grid(page).getByText('Demonstração cozinha')).toBeVisible();
        await settle(page);
        const gridMin = await minContrast(page, '.hm-calendar');
        const rail = await minContrast(page, 'aside');
        expect(gridMin, `grade (${theme})`).toBeGreaterThanOrEqual(4.5);
        expect(rail, `trilha (${theme})`).toBeGreaterThanOrEqual(4.5);
        await viewButton(page, 'Lista').click();
        await expect(page.getByRole('button', { name: /Proposta telhado\. Abrir detalhe\./ })).toBeVisible();
        await settle(page);
        const list = await minContrast(page, 'main');
        expect(list, `lista (${theme})`).toBeGreaterThanOrEqual(4.5);
        console.log(
          `[f72-s06] contraste calendário ${theme}: grade ${gridMin.toFixed(2)} · trilha ${rail.toFixed(2)} · ` +
            `lista ${list.toFixed(2)}`,
        );
      });

      test('evento concluído recua por cor, sem opacidade, e segue ≥ 4,5:1', async ({ page }) => {
        await page.goto('/calendar');
        await expect(grid(page).getByText('Demonstração cozinha')).toBeVisible();
        await settle(page);
        const chip = grid(page).locator('[data-completed]').filter({ hasText: COMPLETED_TITLE });
        await expect(chip).toHaveCount(1);
        const min = await expectCompletedLegible(page, chip, `chip concluído (${theme})`);
        // Os eventos agendados não ganham o marcador.
        await expect(grid(page).locator('[data-completed]')).toHaveCount(1);
        console.log(`[f72-s06] contraste evento concluído ${theme}: ${min.toFixed(2)}`);
      });

      test('axe (se disponível): semana e lista sem violação séria', async ({ page }) => {
        await page.goto('/calendar');
        await expect(grid(page).getByText('Demonstração cozinha')).toBeVisible();
        await expectNoSeriousAxe(page);
        await viewButton(page, 'Lista').click();
        await expect(page.getByRole('button', { name: /Proposta telhado\. Abrir detalhe\./ })).toBeVisible();
        await expectNoSeriousAxe(page);
      });

      test('capturas 1440: semana, dia e lista', async ({ page }) => {
        await page.goto('/calendar');
        await expect(grid(page).getByText('Demonstração cozinha')).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-4-calendario-semana.png`, animations: 'disabled' });
        await viewButton(page, 'Dia').click();
        await expect(grid(page).locator('.fc-timeGridDay-view')).toHaveCount(1);
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-5-calendario-dia.png`, animations: 'disabled' });
        await viewButton(page, 'Lista').click();
        await expect(page.getByRole('button', { name: /Proposta telhado\. Abrir detalhe\./ })).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-6-calendario-lista.png`, animations: 'disabled' });
      });
    });

    test.describe('mobile 375', () => {
      test.use({ viewport: { width: 375, height: 812 } });

      test('aba Agenda ativa; timeline do dia com tons e a linha "agora"; captura', async ({ page }) => {
        await page.goto('/calendar');
        const tabs = page.getByRole('navigation', { name: 'Navegação principal' });
        await expect(tabs.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByText('Demonstração cozinha')).toBeVisible();
        await expect(page.locator('main [data-event-tone]')).toHaveCount(SEEDS.length);
        await expect(
          page.getByRole('button', { name: /Proposta telhado/ }).locator('[data-event-tone]'),
        ).toHaveAttribute('data-event-tone', 'warn');
        // "Agora" entre o primeiro (00:05) e o último (23:20) evento do dia; é o único que pulsa.
        await expect(page.getByRole('separator', { name: /^Agora, \d{2}:\d{2}$/ })).toHaveCount(1);
        await settle(page);
        const live = await infiniteAnimations(page);
        expect(live, live.join(' | ')).toHaveLength(1);
        await page.screenshot({ path: `${SHOTS}/375-${theme}-3-agenda.png`, animations: 'disabled' });
      });

      test('contraste e axe 375 (se disponível)', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByText('Demonstração cozinha')).toBeVisible();
        await settle(page);
        const min = await minContrast(page, 'main');
        expect(min, `agenda mobile (${theme})`).toBeGreaterThanOrEqual(4.5);
        const done = page.locator('main [data-completed]').filter({ hasText: COMPLETED_TITLE });
        await expect(done).toHaveCount(1);
        await expectCompletedLegible(page, done, `agenda concluído (${theme})`);
        await expectNoSeriousAxe(page);
      });
    });
  });
}
