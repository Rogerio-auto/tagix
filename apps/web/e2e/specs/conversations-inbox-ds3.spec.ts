/**
 * F72-S05 — Inbox no DS 3.0: lista acessível (nav + ul de links), avatar sem número,
 * homônimos com telefone, seleção sem neon, bolhas/composer (com a restrição da
 * F60-S11)/cockpit, nos dois temas, em 375 e 1440 (768 de bônus na lista).
 * Rede 100% mockada pela fixture (ver nota de ambiente em `mobile-nav.spec.ts`).
 *
 * Não há axe no repositório: `nested-interactive` é provado pela estrutura (papéis
 * no DOM e nenhum controle dentro de outro) e o contraste por cálculo WCAG sobre a
 * cor computada, com o fundo composto pelas camadas translúcidas até a primeira
 * opaca (mesma linha da S03/S04). Se um axe-core aparecer no store do pnpm, o teste
 * de axe roda também.
 *
 * Capturas em `e2e/.artifacts/f72-s05/`. A inbox é full-bleed (o `<main>` não rola;
 * o scroll vive na lista e na thread), então a captura da viewport é a tela inteira.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { CONVERSATION, ME } from '../fixtures/seed';

// Contexto do NAVEGADOR de teste (não é formatação no componente): fixa o usuário
// brasileiro que a captura precisa provar.
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

const SHOTS = 'e2e/.artifacts/f72-s05';

// `kind` real do schema (`direct`) + `channelProvider` (o selo de canal vem do provider).
const base = { ...CONVERSATION, kind: 'direct', channelProvider: 'meta_whatsapp', contactProfileName: null, assignedTo: null };
const rows = [
  { ...base, id: 'conv_a', contactId: 'k_a', remoteId: '5569999670030', contactDisplayName: 'Maria Souza', unreadCount: 2, aiMode: 'on', lastMessagePreview: 'Podemos agendar a visita?' },
  { ...base, id: 'conv_b', contactId: 'k_b', remoteId: '5511988887777', contactDisplayName: 'Maria Souza', unreadCount: 0, aiMode: 'paused', lastMessagePreview: 'Obrigada!', lastMessageAt: '2026-06-11T10:00:00.000Z' },
  { ...base, id: 'conv_c', contactId: 'k_c', remoteId: '5548991112222', contactDisplayName: null, unreadCount: 0, aiMode: 'off', lastMessagePreview: 'Qual o prazo da obra?', lastMessageAt: '2026-06-10T10:00:00.000Z' },
  { ...base, id: 'conv_d', contactId: 'k_d', remoteId: '@carla.reis', channelProvider: 'meta_instagram', contactDisplayName: 'Carla Reis', unreadCount: 0, aiMode: 'off', lastMessagePreview: '[image]', lastMessageAt: '2026-06-09T10:00:00.000Z' },
];

const msg = (id: string, direction: 'inbound' | 'outbound', senderType: string, content: string, at: string) => ({
  id,
  conversationId: 'conv_a',
  direction,
  senderType,
  type: 'text',
  content,
  viewStatus: direction === 'outbound' ? 'read' : 'delivered',
  mediaUrl: null,
  createdAt: at,
});

// A API devolve da mais recente para a mais antiga.
const thread = [
  msg('m4', 'inbound', 'contact', 'Podemos agendar a visita?', '2026-06-12T13:04:00.000Z'),
  msg('m3', 'outbound', 'agent', 'Perfeito. Qual o CEP do imóvel? Assim já confiro a agenda da equipe.', '2026-06-12T13:02:00.000Z'),
  msg('m2', 'inbound', 'contact', 'Quero um orçamento para a reforma da cozinha.', '2026-06-12T13:01:00.000Z'),
  msg('m1', 'inbound', 'contact', 'Oi! Vi o anúncio de vocês.', '2026-06-12T13:00:00.000Z'),
];

function detailFor(id: string): Record<string, unknown> {
  const row = rows.find((r) => r.id === id) ?? rows[0];
  return {
    id: row?.id,
    contactId: row?.contactId,
    channelId: CONVERSATION.channelId,
    channelProvider: row?.channelProvider,
    remoteId: row?.remoteId,
    kind: row?.kind,
    status: 'open',
    aiMode: row?.aiMode,
    aiPausedReason: null,
    aiPausedAt: null,
    assignedTo: ME.member.id,
    assignedToName: ME.member.name,
    departmentId: null,
    departmentName: null,
    agentId: null,
    agentName: null,
    stageName: null,
    unreadCount: 0,
    lastMessageAt: row?.lastMessageAt,
    createdAt: '2026-06-12T12:00:00.000Z',
    updatedAt: '2026-06-12T13:00:00.000Z',
    contact: { id: row?.contactId, displayName: row?.contactDisplayName, profileName: null },
  };
}

const WINDOW = {
  provider: 'meta_whatsapp',
  isOpen: true,
  expiresAt: '2026-06-13T13:00:00.000Z',
  requiresTemplate: false,
  messageTag: null,
};

const json = (route: Route, body: unknown): Promise<void> =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function install(page: Page): Promise<void> {
  await page.route(/\/api\/conversations(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { conversations: rows }) : route.fallback(),
  );
  await page.route(/\/api\/conversations\/([^/?]+)$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = /conversations\/([^/?]+)$/.exec(route.request().url())?.[1] ?? 'conv_a';
    return json(route, { conversation: detailFor(id) });
  });
  await page.route(/\/api\/conversations\/[^/]+\/messages(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { messages: thread }) : route.fallback(),
  );
  // Ficha do contato (painel do cockpit): o fallback `{}` da fixture derruba o ContactPanel.
  await page.route(/\/api\/contacts\/([^/?]+)$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = /contacts\/([^/?]+)$/.exec(route.request().url())?.[1] ?? 'k_a';
    const row = rows.find((r) => r.contactId === id) ?? rows[0];
    return json(route, {
      contact: {
        id,
        workspaceId: ME.member.workspaceId,
        displayName: row?.contactDisplayName ?? null,
        phone: row?.channelProvider === 'meta_instagram' ? null : `+${row?.remoteId ?? ''}`,
        email: null,
        avatarUrl: null,
        notes: null,
        language: null,
        source: row?.channelProvider === 'meta_instagram' ? 'instagram' : 'whatsapp',
        marketingOptIn: false,
        optInMethod: null,
        optInSource: null,
        optInAt: null,
        optOutAt: null,
        optOutReason: null,
        ownerId: null,
        customFields: {},
        address: {},
        document: null,
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: null,
        deletedAt: null,
      },
      tags: [],
      conversations: [],
      deals: [],
      conversions: [],
      consent: [],
      marketingOptIn: false,
    });
  });
  // conv_b: o portão (F60-S11) recusa por horário — o composer mostra a restrição.
  await page.route(/\/api\/conversations\/[^/]+\/window(\?.*)?$/, (route) => {
    const blocked = route.request().url().includes('/conv_b/');
    return json(route, {
      window: WINDOW,
      restriction: blocked
        ? {
            canSend: false,
            reason: 'quiet_hours',
            message: 'Fora do horário permitido para envio no fuso do contato.',
            retryAt: '2026-06-13T11:00:00.000Z',
          }
        : { canSend: true, reason: 'ok', message: '', retryAt: null },
    });
  });
}

const list = (page: Page): Locator => page.getByRole('navigation', { name: 'Conversas' });

/**
 * Menor contraste (WCAG) do texto visível dentro de `selector`. O fundo de cada texto
 * é a composição das camadas de `background-color` dos ancestrais até a primeira
 * opaca (ou `--bg`). Cores passam por um canvas, que normaliza qualquer sintaxe
 * computada (oklab/color-mix do Tailwind 4) para sRGB 8 bits.
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
      const a = (d[3] ?? 0) / 255;
      // getImageData devolve pré-multiplicado desfeito; com alfa 0 não há cor.
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, a];
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

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
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

/** Roda o axe (WCAG 2.1 A/AA) na página e devolve as violações resumidas. */
async function axeViolations(page: Page, axePath: string): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    interface AxeResult {
      violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[];
    }
    const w = window as unknown as {
      axe: { run: (ctx: unknown, opts: unknown) => Promise<AxeResult> };
    };
    const r = await w.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
  });
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Inbox DS 3.0 — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(90_000);
      await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
      await install(page);
    });

    test.describe('desktop 1440', () => {
      test.use({ viewport: { width: 1440, height: 900 } });

      test('lista é nav + ul de links: sem listbox/option e sem controle dentro de controle', async ({ page }) => {
        await page.goto('/conversations/conv_a');
        const nav = list(page);
        await expect(nav).toBeVisible();
        await expect(nav.locator(':scope > ul > li > a')).toHaveCount(rows.length);
        await expect(page.getByRole('listbox', { name: 'Conversas' })).toHaveCount(0);
        await expect(nav.locator('[role="option"], [role="listbox"], li[role]')).toHaveCount(0);
        // nested-interactive: nenhum elemento focável/interativo dentro de um link.
        await expect(
          nav.locator(
            'a :is(a, button, input, select, textarea, [tabindex], [role="button"], [role="link"], [role="option"], [role="checkbox"])',
          ),
        ).toHaveCount(0);
        await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
        // Roving: exatamente um link na ordem de Tab, e é o da conversa aberta.
        await expect(nav.locator('a[tabindex="0"]')).toHaveCount(1);
        await expect(nav.locator('a[tabindex="0"]')).toHaveAttribute('data-conversation-id', 'conv_a');
      });

      test('setas, Home e End movem o foco entre as conversas', async ({ page }) => {
        await page.goto('/conversations');
        const links = list(page).getByRole('link');
        await links.first().focus();
        await page.keyboard.press('ArrowDown');
        await expect(links.nth(1)).toBeFocused();
        await page.keyboard.press('End');
        await expect(links.nth(rows.length - 1)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(links.nth(rows.length - 2)).toBeFocused();
        await page.keyboard.press('Home');
        await expect(links.first()).toBeFocused();
        // Enter segue o link focado (navegação nativa do <a>).
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/conversations\/conv_b$/);
      });

      test('sem nome: ícone de pessoa; homônimos mostram o telefone; cor estável', async ({ page }) => {
        await page.goto('/conversations');
        const nav = list(page);
        const noName = nav.locator('a[data-conversation-id="conv_c"]');
        await expect(noName.locator('svg.lucide-user')).toHaveCount(1);
        await expect(noName).not.toContainText('#');
        await expect(nav.locator('a[data-conversation-id="conv_a"]')).toContainText('+55 (69) 99967-0030');
        await expect(nav.locator('a[data-conversation-id="conv_b"]')).toContainText('+55 (11) 98888-7777');
        await expect(nav.locator('a[data-conversation-id="conv_d"]')).not.toContainText('@carla.reis');
        // Selo de canal pelo provider.
        await expect(nav.locator('a[data-conversation-id="conv_a"]').getByRole('img', { name: 'WhatsApp' })).toHaveCount(1);
        await expect(nav.locator('a[data-conversation-id="conv_d"]').getByRole('img', { name: 'Instagram' })).toHaveCount(1);
        // A mesma pessoa tem a mesma cor na lista e no cabeçalho da conversa.
        const toneInList = await nav
          .locator('a[data-conversation-id="conv_a"] [data-avatar-tone]')
          .getAttribute('data-avatar-tone');
        await settle(page);
        await nav.locator('a[data-conversation-id="conv_a"]').click();
        await expect(page).toHaveURL(/\/conversations\/conv_a$/);
        await expect(page.locator('header [data-avatar-tone]').first()).toHaveAttribute(
          'data-avatar-tone',
          toneInList ?? '',
        );
      });

      test('seleção ativa sem animação contínua; foco visível', async ({ page }) => {
        await page.goto('/conversations/conv_a');
        const active = page.locator('a[data-conversation-id="conv_a"][aria-current="page"]');
        await expect(active).toBeVisible();
        const infinite = await active.evaluate(
          (el) =>
            el
              .getAnimations({ subtree: true })
              .filter((a) => a.effect?.getTiming().iterations === Infinity).length,
        );
        expect(infinite).toBe(0);
        const links = list(page).getByRole('link');
        await links.first().focus();
        await page.keyboard.press('ArrowDown');
        const outline = await links.nth(1).evaluate((el) => {
          const s = getComputedStyle(el);
          return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
        });
        expect(outline.style).toBe('solid');
        expect(outline.width).toBeGreaterThanOrEqual(2);
      });

      test('contraste ≥ 4,5:1: selos de IA, não lidas, avatares, bolhas e restrição', async ({ page }) => {
        await page.goto('/conversations/conv_a');
        await expect(list(page)).toBeVisible();
        await expect(page.getByText('Quero um orçamento para a reforma da cozinha.')).toBeVisible();
        const ia = await minContrast(page, 'nav[aria-label="Conversas"] [aria-label="IA ativa"]');
        const paused = await minContrast(page, 'nav[aria-label="Conversas"] [aria-label^="IA pausada"]');
        const unread = await minContrast(page, 'nav[aria-label="Conversas"] [aria-label$="não lidas"]');
        const avatars = await minContrast(page, '[data-avatar-tone]');
        const listText = await minContrast(page, 'nav[aria-label="Conversas"]');
        const threadText = await minContrast(page, 'section');
        expect(ia, `selo IA (${theme})`).toBeGreaterThanOrEqual(4.5);
        expect(paused, `selo Pausada (${theme})`).toBeGreaterThanOrEqual(4.5);
        expect(unread, `não lidas (${theme})`).toBeGreaterThanOrEqual(4.5);
        expect(avatars, `avatares (${theme})`).toBeGreaterThanOrEqual(4.5);
        expect(listText, `lista (${theme})`).toBeGreaterThanOrEqual(4.5);
        expect(threadText, `thread (${theme})`).toBeGreaterThanOrEqual(4.5);
        console.log(
          `[f72-s05] contraste ${theme}: IA ${ia.toFixed(2)} · Pausada ${paused.toFixed(2)} · ` +
            `não lidas ${unread.toFixed(2)} · avatares ${avatars.toFixed(2)} · lista ${listText.toFixed(2)} · ` +
            `thread ${threadText.toFixed(2)}`,
        );

        await page.goto('/conversations/conv_b');
        const notice = page.locator('[data-restriction="quiet_hours"]');
        await expect(notice).toBeVisible();
        await expect(page.getByPlaceholder('Envio travado — veja o motivo acima')).toBeDisabled();
        const restriction = await minContrast(page, '[data-restriction="quiet_hours"]');
        expect(restriction, `restrição (${theme})`).toBeGreaterThanOrEqual(4.5);
        console.log(`[f72-s05] contraste ${theme}: restrição ${restriction.toFixed(2)}`);
      });

      test('axe (se disponível): sem violação séria ou crítica', async ({ page }) => {
        const axe = findAxe();
        test.skip(axe === null, 'axe-core não está no store do pnpm (o repo não depende dele)');
        await page.goto('/conversations/conv_a');
        await expect(list(page)).toBeVisible();
        const violations = await axeViolations(page, axe as string);
        // O alvo do slot: nenhum `nested-interactive`, de qualquer impacto.
        expect(violations.filter((v) => v.id === 'nested-interactive')).toEqual([]);
        const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
      });

      test('capturas 1440', async ({ page }) => {
        await page.goto('/conversations');
        await expect(list(page)).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-1-lista.png`, animations: 'disabled' });

        await page.goto('/conversations/conv_a');
        await expect(page.getByText('Quero um orçamento para a reforma da cozinha.')).toBeVisible();
        await expect(page.getByText('Cockpit')).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-2-conversa-cockpit.png`, animations: 'disabled' });

        await page.goto('/conversations/conv_b');
        await expect(page.locator('[data-restriction="quiet_hours"]')).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/1440-${theme}-3-restricao.png`, animations: 'disabled' });
      });
    });

    test.describe('768', () => {
      test.use({ viewport: { width: 768, height: 1024 } });
      test('captura 768', async ({ page }) => {
        await page.goto('/conversations/conv_a');
        await expect(list(page)).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/768-${theme}-1-conversa.png`, animations: 'disabled' });
      });
    });

    test.describe('mobile 375', () => {
      test.use({ viewport: { width: 375, height: 812 } });

      test('aba Inbox ativa; lista → conversa → cockpit; capturas', async ({ page }) => {
        await page.goto('/conversations');
        await expect(list(page)).toBeVisible();
        const tabs = page.getByRole('navigation', { name: 'Navegação principal' });
        await expect(tabs.locator('a[aria-current="page"]')).toContainText('Inbox');
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/375-${theme}-1-lista.png`, animations: 'disabled' });

        await settle(page);
        await list(page).locator('a[data-conversation-id="conv_a"]').click();
        await expect(page).toHaveURL(/\/conversations\/conv_a$/);
        await expect(page.getByPlaceholder('Escreva uma mensagem…')).toBeVisible();
        await expect(page.getByText('Quero um orçamento para a reforma da cozinha.')).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/375-${theme}-2-conversa.png`, animations: 'disabled' });

        await page.getByRole('button', { name: 'Abrir cockpit da conversa' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/375-${theme}-3-cockpit.png`, animations: 'disabled' });
      });

      test('axe 375 (se disponível): lista sem nested-interactive nem violação séria', async ({ page }) => {
        const axe = findAxe();
        test.skip(axe === null, 'axe-core não está no store do pnpm (o repo não depende dele)');
        await page.goto('/conversations');
        await expect(list(page)).toBeVisible();
        const violations = await axeViolations(page, axe as string);
        expect(violations.filter((v) => v.id === 'nested-interactive')).toEqual([]);
        const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
      });

      test('restrição de envio no composer (375)', async ({ page }) => {
        await page.goto('/conversations/conv_b');
        await expect(page.locator('[data-restriction="quiet_hours"]')).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/375-${theme}-4-restricao.png`, animations: 'disabled' });
      });
    });
  });
}
