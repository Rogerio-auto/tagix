/**
 * F72-S04 — Home do DS 3.0 ("o que mudou", resultado no topo, "precisa da sua
 * atenção"). Rede 100% mockada pela fixture (`HOME_OWNER`/`TODAY` no seed); o recorte
 * de AGENT é sobrescrito aqui. A tela não decide visibilidade: o teste prova que ela
 * renderiza o que o servidor manda, e nada além.
 *
 * Não há axe no repositório (`@axe-core/playwright` não é dependência): as checagens
 * de acessibilidade aqui são as mesmas da F72-S03 — contraste WCAG calculado sobre a
 * cor computada contra `--surface`, nomes acessíveis e landmarks.
 *
 * Capturas: o shell do app rola por dentro do `<main>` (o documento não rola), então
 * `fullPage` só fotografava a primeira tela (e, de quebra, o bottom-sheet fechado do
 * onboarding, que mora transladado abaixo da dobra). Cada combinação gera duas: a
 * primeira dobra como o usuário a vê, e a página inteira com a viewport esticada até
 * caber todo o `<main>` (o shell real, sem CSS injetado).
 *
 * Locale e fuso fixos: o código formata datas com o locale do navegador (`undefined`,
 * regra F59); o teste prova o pt-BR que o usuário brasileiro vê.
 *
 * AMBIENTE: ver nota em `mobile-nav.spec.ts` (rodar com `--workers=1`).
 */

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { CONVERSATION } from '../fixtures/seed';

const SHOTS = 'e2e/.artifacts/f72-s04';

// Contexto do NAVEGADOR de teste (não é formatação no componente): fixa o usuário
// brasileiro que a captura precisa provar.
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const result = (page: Page) => page.getByRole('region', { name: 'Resultado do período' });
const attention = (page: Page) => page.getByRole('region', { name: 'Precisa da sua atenção' });

/** Menor contraste (WCAG) entre o texto visível de `selector` e `--surface`. */
async function minContrast(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const channel = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const parse = (css: string): number[] => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r = 0, g = 0, b = 0]: number[]): number =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const probe = document.createElement('span');
    probe.style.color = 'var(--surface)';
    document.body.appendChild(probe);
    const bg = lum(parse(getComputedStyle(probe).color));
    probe.remove();

    let min = Infinity;
    for (const root of Array.from(document.querySelectorAll(sel))) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        const ownText = Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        if (!ownText || el.closest('.sr-only') || el.getClientRects().length === 0) continue;
        const fg = lum(parse(getComputedStyle(el).color));
        const [hi, lo] = [fg, bg].sort((a, b) => b - a);
        min = Math.min(min, ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05));
      }
    }
    return min;
  }, selector);
}

/**
 * Linha de base de cada número de KPI, agrupada pela faixa visual (topo da célula).
 * Mede com uma sonda inline-block vazia no fim do número: o fundo dela é a linha de
 * base do texto, independentemente do corpo da fonte.
 */
async function kpiBaselineSpread(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const rows = new Map<number, number[]>();
    for (const cell of Array.from(document.querySelectorAll<HTMLElement>('[data-kpi]'))) {
      const value = cell.querySelector<HTMLElement>('[data-kpi-value] > [aria-hidden]');
      if (!value) continue;
      const probe = document.createElement('span');
      probe.style.display = 'inline-block';
      probe.style.width = '0';
      probe.style.height = '0';
      value.appendChild(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      const top = Math.round(cell.getBoundingClientRect().top);
      rows.set(top, [...(rows.get(top) ?? []), baseline]);
    }
    return Array.from(rows.values())
      .filter((r) => r.length > 1)
      .map((r) => Math.max(...r) - Math.min(...r));
  });
}

/** Contraste (WCAG) entre o traço da linha do gráfico e `--surface`. */
async function chartLineContrast(page: Page): Promise<number> {
  return page.evaluate(() => {
    const channel = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const parse = (css: string): number[] => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r = 0, g = 0, b = 0]: number[]): number =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const probe = document.createElement('span');
    probe.style.color = 'var(--surface)';
    document.body.appendChild(probe);
    const bg = lum(parse(getComputedStyle(probe).color));
    probe.remove();
    const line = document.querySelector<SVGPathElement>('svg path[fill="none"]');
    if (!line) return 0;
    const fg = lum(parse(getComputedStyle(line).stroke));
    const [hi, lo] = [fg, bg].sort((a, b) => b - a);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  });
}

/** O onboarding está concluído: o wizard (bottom-sheet no celular) não está à vista. */
async function expectNoOnboarding(page: Page): Promise<void> {
  await expect(
    page.getByRole('dialog', { name: 'Configuração inicial da Leadium' }),
  ).toHaveCount(0);
  await expect(page.getByText('Bem-vindo à Leadium')).not.toBeInViewport();
}

/**
 * Duas capturas por combinação: a primeira dobra (o que o usuário vê ao abrir) e a
 * página inteira, com a viewport esticada até o `<main>` não rolar mais.
 */
async function captureHome(page: Page, width: number, theme: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({
    path: `${SHOTS}/home-${width}-${theme}-1-dobra.png`,
    animations: 'disabled',
  });
  const viewport = page.viewportSize();
  const main = page.locator('main');
  const extra = await main.evaluate((el) => el.scrollHeight - el.clientHeight);
  if (viewport && extra > 0) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height + extra });
    await expect
      .poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThanOrEqual(1);
  }
  await page.screenshot({
    path: `${SHOTS}/home-${width}-${theme}-2-inteira.png`,
    animations: 'disabled',
  });
  if (viewport) await page.setViewportSize(viewport);
}

/** Recorte de um AGENT: só a fila dele, sem dinheiro nem série da empresa. */
async function asAgent(page: Page): Promise<void> {
  await page.route('**/api/me', (route) =>
    fulfillJson(route, {
      member: {
        id: 'mem_agent',
        workspaceId: 'ws_e2e',
        name: 'Bia Atendente',
        role: 'AGENT',
        status: 'active',
      },
      workspace: {
        id: 'ws_e2e',
        name: 'Clínica Aurora',
        subscriptionStatus: 'active',
        trialEndsAt: null,
      },
      memberships: [
        {
          workspaceId: 'ws_e2e',
          name: 'Clínica Aurora',
          slug: 'aurora',
          role: 'AGENT',
          subscriptionStatus: 'active',
        },
      ],
    }),
  );
  await page.route('**/api/dashboard/me', (route) =>
    fulfillJson(route, {
      role: 'AGENT',
      cards: [],
      alerts: [],
      layoutPreferences: { hidden: [], order: [], period: null },
    }),
  );
  await page.route('**/api/dashboard/home**', (route) =>
    fulfillJson(route, {
      scope: 'personal',
      role: 'AGENT',
      periodDays: 30,
      window: {
        from: '2026-05-13T12:00:00.000Z',
        to: '2026-06-12T12:00:00.000Z',
        previousFrom: '2026-04-13T12:00:00.000Z',
        previousTo: '2026-05-13T12:00:00.000Z',
      },
      thresholds: { slaMinutes: 15, slaSource: 'default', stalledDays: 7, mediaFailedDays: 7 },
      kpis: [
        {
          key: 'waiting_mine',
          unit: 'count',
          value: 2,
          previous: null,
          betterWhen: 'lower',
          href: '/conversations?status=open',
          sample: null,
        },
        {
          key: 'open_mine',
          unit: 'count',
          value: 6,
          previous: null,
          betterWhen: 'lower',
          href: '/conversations?status=open',
          sample: null,
        },
        {
          key: 'resolved_mine',
          unit: 'count',
          value: 4,
          previous: null,
          betterWhen: 'higher',
          href: '/conversations',
          sample: null,
        },
        {
          key: 'speed_to_lead',
          unit: 'seconds',
          value: 95,
          previous: 120,
          betterWhen: 'lower',
          href: '/conversations',
          sample: { answered: 12, unanswered: 1 },
        },
      ],
      attention: [],
      journey: null,
      revenueSeries: null,
      serverTime: '2026-06-12T12:00:00.000Z',
    }),
  );
  await page.route('**/api/dashboard/today', (route) =>
    fulfillJson(route, {
      waiting: [],
      waitingTotal: 0,
      waitingBands: { esfriando: 0, atencao: 0, agora: 0 },
      appointments: [],
      month: null,
      serverTime: '2026-06-12T12:00:00.000Z',
    }),
  );
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Home — OWNER 1440 — ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
    });

    test('o que mudou + KPIs de resultado em mono, com delta e amostra', async ({ page }) => {
      await page.goto('/');
      const kpis = result(page);
      await expect(kpis).toBeVisible();

      // Manchete honesta: delta contra a janela anterior, não "desde a última visita".
      await expect(
        page.getByText('A receita atribuída subiu 18% em 30 dias.', { exact: false }),
      ).toBeVisible();
      await expect(page.locator('[data-home-window]')).toContainText('Últimos 30 dias · vs.');
      // pt-BR de ponta a ponta (locale do navegador): data, janela de comparação.
      await expect(page.getByText('sexta-feira, 12 de junho', { exact: true })).toBeVisible();
      await expect(page.locator('[data-home-window]')).toContainText('13 de abr.');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bom dia, Ana.');

      for (const label of ['Receita atribuída', 'Leads novos', 'Speed to lead', 'Conversões']) {
        await expect(kpis.getByText(label, { exact: true })).toBeVisible();
      }
      const revenue = kpis.locator('[data-kpi="revenue"]');
      await expect(revenue).toContainText('184.200');
      await expect(revenue).toHaveAttribute('href', '/conversions');
      const speed = kpis.locator('[data-kpi="speed_to_lead"]');
      await expect(speed).toContainText('00:41');
      await expect(speed).toContainText('18s mais rápido');
      await expect(speed.locator('[data-kpi-sample]')).toHaveText(
        '84 respondidas · 5 sem resposta',
      );

      // Número na IBM Plex Mono do token, primeira da pilha. `/mono/` não bastava: o
      // default do Tailwind (`ui-monospace, …`) também casa, e foi ele que vazou.
      const family = await revenue
        .locator('span.font-mono')
        .last()
        .evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
      expect(family).toMatch(/^"?ibm plex mono/);

      // Painel do dono: série de receita e jornada vieram do servidor. A série soma
      // exatamente o KPI (o total do gráfico é o mesmo número da faixa).
      const chart = page.getByRole('region', { name: 'Receita atribuída' });
      await expect(chart).toBeVisible();
      await expect(chart).toContainText('R$ 184.200');
      await expect(page.getByRole('region', { name: 'Da conversa ao fechamento' })).toBeVisible();
      // A fila e a agenda da antiga /hoje vivem aqui.
      await expect(page.getByRole('region', { name: 'Aguardando resposta' })).toContainText(
        'Ana Souza',
      );
      await expect(page.getByRole('region', { name: 'Agenda do dia' })).toContainText('Avaliação');
    });

    test('"Precisa da sua atenção": cada item tem ação navegável', async ({ page }) => {
      await page.goto('/');
      const list = attention(page);
      await expect(list.getByRole('link')).toHaveCount(2);
      const waiting = list.locator('[data-attention="waiting_sla"]');
      await expect(waiting).toContainText('1 conversa esperando há mais de 15 min');
      await expect(waiting).toContainText('Responder');
      await expect(waiting).toHaveAttribute('href', `/conversations/${CONVERSATION.id}`);
      await expect(waiting).toHaveAttribute('data-target-id', CONVERSATION.id);
      await expect(list.locator('[data-attention="deals_stalled"]')).toHaveAttribute(
        'href',
        '/pipeline',
      );

      await waiting.click();
      await expect(page).toHaveURL(new RegExp(`/conversations/${CONVERSATION.id}$`));
    });

    test('seletor de janela pede o período ao servidor', async ({ page }) => {
      const asked: string[] = [];
      page.on('request', (req) => {
        const url = new URL(req.url());
        if (url.pathname === '/api/dashboard/home')
          asked.push(url.searchParams.get('period') ?? '');
      });
      await page.goto('/');
      const group = page.getByRole('group', { name: 'Período' });
      await expect(group.getByRole('button', { name: 'Últimos 30 dias' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await group.getByRole('button', { name: 'Últimos 7 dias' }).click();
      await expect(group.getByRole('button', { name: 'Últimos 7 dias' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect.poll(() => asked).toContain('7d');
      expect(asked).toContain('30d');
    });

    test('contraste do texto da Home >= 4,5:1 e foco visível', async ({ page }) => {
      await page.goto('/');
      await expect(result(page)).toBeVisible();
      await expect(attention(page).getByRole('link').first()).toBeVisible();
      // Espera a contagem dos números terminar (cores não mudam, mas o texto sim).
      await page.waitForTimeout(800);
      expect(
        await minContrast(page, 'section[aria-label="Resultado do período"]'),
      ).toBeGreaterThanOrEqual(4.5);
      expect(await minContrast(page, 'header:has(h1)')).toBeGreaterThanOrEqual(4.5);

      const first = result(page).getByRole('link').first();
      await page.keyboard.press('Tab');
      await first.focus();
      const ring = await first.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      expect(ring.style).toBe('solid');
      expect(ring.width).toBeGreaterThanOrEqual(2);
    });

    test('regra do §07: nenhum custo de IA/infra na Home', async ({ page }) => {
      await page.goto('/');
      await expect(result(page)).toBeVisible();
      const top = (await page.locator('main').innerText()).toLowerCase();
      expect(top).not.toMatch(/custo de ia|llm|\btokens?\b|infraestrutura/);
    });

    test('números dos KPIs na mesma linha de base; selo e período na linha da janela', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      await expect(result(page)).toBeVisible();
      const spreads = await kpiBaselineSpread(page);
      expect(spreads.length).toBeGreaterThan(0);
      for (const spread of spreads) expect(spread).toBeLessThanOrEqual(1);

      // Selo "ao vivo" e seletor de período centrados na linha "Últimos 30 dias".
      const center = async (l: ReturnType<typeof result>): Promise<number> => {
        const box = await l.boundingBox();
        return box ? box.y + box.height / 2 : Number.NaN;
      };
      const yWindow = await center(page.locator('[data-home-window]'));
      const yPeriod = await center(page.getByRole('group', { name: 'Período' }));
      expect(Math.abs(yWindow - yPeriod)).toBeLessThanOrEqual(2);
    });

    test('linha do gráfico com contraste >= 3:1 contra a superfície', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Receita atribuída' })).toBeVisible();
      expect(await chartLineContrast(page)).toBeGreaterThanOrEqual(3);
    });

    test('captura 1440', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      await expect(result(page)).toBeVisible();
      await expect(attention(page).getByRole('link').first()).toBeVisible();
      await expectNoOnboarding(page);
      await captureHome(page, 1440, theme);
    });
  });

  test.describe(`Home — 768 — ${theme}`, () => {
    test.use({ viewport: { width: 768, height: 1024 } });
    test('captura 768', async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      await expect(result(page)).toBeVisible();
      await expect(attention(page).getByRole('link').first()).toBeVisible();
      await expectNoOnboarding(page);
      for (const spread of await kpiBaselineSpread(page)) expect(spread).toBeLessThanOrEqual(1);
      await captureHome(page, 768, theme);
    });
  });

  test.describe(`Home — mobile 375 — ${theme}`, () => {
    test.use({ viewport: { width: 375, height: 812 } });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
    });

    test('resultado no topo, depois atenção, depois o gráfico', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      const kpis = result(page);
      const list = attention(page);
      const chart = page.getByRole('region', { name: 'Receita atribuída' });
      await expect(kpis).toBeVisible();
      await expect(list).toBeVisible();
      const y = async (l: ReturnType<typeof result>): Promise<number> =>
        (await l.boundingBox())?.y ?? Number.NaN;
      const [yKpi, yAttention, yChart] = [await y(kpis), await y(list), await y(chart)];
      expect(yKpi).toBeLessThan(yAttention);
      expect(yAttention).toBeLessThan(yChart);

      // Nada estoura a largura do celular.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // A aba Home é a ativa e aponta para `/`.
      const tab = page
        .getByRole('navigation', { name: 'Navegação principal' })
        .getByRole('link', { name: 'Home' });
      await expect(tab).toHaveAttribute('href', '/');
      await expect(tab).toHaveAttribute('aria-current', 'page');

      // KPIs alinhados também na grade do celular (manchete + três numa linha).
      const spreads = await kpiBaselineSpread(page);
      expect(spreads.length).toBeGreaterThan(0);
      for (const spread of spreads) expect(spread).toBeLessThanOrEqual(1);

      // A primeira linha de "Precisa da sua atenção" cabe na primeira tela, acima da
      // barra de navegação de baixo.
      const firstRow = await list.getByRole('link').first().boundingBox();
      const nav = await page
        .getByRole('navigation', { name: 'Navegação principal' })
        .boundingBox();
      expect(firstRow).not.toBeNull();
      expect(nav).not.toBeNull();
      if (firstRow && nav) expect(firstRow.y + firstRow.height).toBeLessThanOrEqual(nav.y);

      await expectNoOnboarding(page);
      await captureHome(page, 375, theme);
    });
  });
}

test.describe('Home — papel AGENT (o servidor recorta)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('vê a própria fila; não vê receita, jornada nem dinheiro', async ({ page }) => {
    await asAgent(page);
    await page.goto('/');
    const kpis = result(page);
    await expect(kpis).toBeVisible();
    for (const label of ['Esperando você', 'Em andamento', 'Resolvidas hoje', 'Speed to lead']) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('2 conversas esperam por você.')).toBeVisible();

    await expect(page.getByText('Receita atribuída')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Da conversa ao fechamento' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Período' })).toHaveCount(0);
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/R\$/);
    await expect(page.getByRole('region', { name: 'Sua agenda' })).toBeVisible();
    // Fila vazia de atendente não vira o convite de "empresa nova".
    await expect(page.locator('[data-home-empty]')).toHaveCount(0);
  });
});

test.describe('Home — /hoje e estados', () => {
  test('/hoje redireciona para a Home (atalho do PWA antigo)', async ({ page }) => {
    await page.goto('/hoje');
    await expect(page).toHaveURL((url) => url.pathname === '/');
    await expect(result(page)).toBeVisible();
  });

  test('o manifest abre o app na Home', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as { start_url?: string };
    expect(manifest.start_url).toBe('/');
  });

  test('erro em 3 partes com "Tentar de novo"', async ({ page }) => {
    await page.route('**/api/dashboard/home**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
    );
    await page.goto('/');
    await expect(page.getByText('Não foi possível carregar a Home')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Tentar de novo' }).first()).toBeVisible();
  });
});
