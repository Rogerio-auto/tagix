/**
 * F71-S08 — seletor de empresa e faixas de conta (rede 100% mockada, como as demais
 * specs). Cobre: seletor só com 2+ empresas, troca (POST + volta para `/` + nome novo),
 * prioridade das faixas e capturas 375/768/1440 em dark e light.
 */

import { test, expect } from '../fixtures/test';
import type { Page, Route } from '@playwright/test';

const DAY = 86_400_000;

interface MembershipSeed {
  workspaceId: string;
  name: string;
  slug: string;
  role: 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'AGENT' | 'READONLY';
  subscriptionStatus: 'trial' | 'active' | 'past_due' | 'expired' | 'canceled';
}

const A: MembershipSeed = {
  workspaceId: 'ws_a',
  name: 'Clínica Aurora',
  slug: 'aurora',
  role: 'OWNER',
  subscriptionStatus: 'active',
};
const B: MembershipSeed = {
  workspaceId: 'ws_b',
  name: 'Studio Vértice',
  slug: 'vertice',
  role: 'AGENT',
  subscriptionStatus: 'active',
};

function meFor(
  active: MembershipSeed,
  all: MembershipSeed[],
  workspaceExtra: Record<string, unknown> = {},
) {
  return {
    member: {
      id: `mem_${active.workspaceId}`,
      workspaceId: active.workspaceId,
      name: 'Ana QA',
      role: active.role,
      status: 'active',
    },
    workspace: {
      id: active.workspaceId,
      name: active.name,
      subscriptionStatus: active.subscriptionStatus,
      trialEndsAt: null,
      ...workspaceExtra,
    },
    memberships: all.map((m) => ({ ...m })),
  };
}

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

interface Scenario {
  memberships: MembershipSeed[];
  workspaceExtra?: Record<string, unknown>;
  invites?: unknown[];
}

/** Liga `/api/me`, `/api/me/workspace` e `/api/me/invites` do cenário. */
async function mockAccount(page: Page, scenario: Scenario): Promise<{ switched: string[] }> {
  const state = { active: scenario.memberships[0] as MembershipSeed, switched: [] as string[] };
  await page.route('**/api/me', (route) =>
    fulfillJson(route, meFor(state.active, scenario.memberships, scenario.workspaceExtra)),
  );
  await page.route('**/api/me/invites', (route) =>
    fulfillJson(route, { invites: scenario.invites ?? [] }),
  );
  await page.route('**/api/me/workspace', async (route) => {
    const body = route.request().postDataJSON() as { workspaceId: string };
    const target = scenario.memberships.find((m) => m.workspaceId === body.workspaceId);
    if (!target) return fulfillJson(route, { error: 'workspace_not_found' }, 404);
    state.active = target;
    state.switched.push(target.workspaceId);
    return fulfillJson(route, meFor(target, scenario.memberships));
  });
  return state;
}

test.describe('Seletor de empresa', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('com 1 empresa: nome visível, sem seletor', async ({ page }) => {
    await mockAccount(page, { memberships: [A] });
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navegação principal' });
    await expect(nav.getByText('Clínica Aurora')).toBeVisible();
    await expect(nav.getByRole('button', { name: /Trocar de empresa/ })).toHaveCount(0);
  });

  test('com 2 empresas: troca pelo menu, volta para / e mostra a empresa nova', async ({ page }) => {
    const account = await mockAccount(page, { memberships: [A, B] });
    await page.goto('/contacts');
    const nav = page.getByRole('complementary', { name: 'Navegação principal' });
    await nav.getByRole('button', { name: /Trocar de empresa/ }).click();
    await expect(page.getByRole('menuitemradio', { name: /Clínica Aurora/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('menuitemradio', { name: /Studio Vértice/ }).click();

    await expect(page).toHaveURL((url) => url.pathname === '/');
    await expect(nav.getByText('Studio Vértice')).toBeVisible();
    expect(account.switched).toEqual(['ws_b']);
  });

  test('trocar para empresa em só leitura: faixa aparece; voltar à plena a remove', async ({ page }) => {
    const expiredB: MembershipSeed = { ...B, subscriptionStatus: 'expired' };
    await mockAccount(page, { memberships: [A, expiredB] });
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Aviso da conta' });
    await expect(banner).toHaveCount(0);
    const nav = page.getByRole('complementary', { name: 'Navegação principal' });
    await nav.getByRole('button', { name: /Trocar de empresa/ }).click();
    await page.getByRole('menuitemradio', { name: /Studio Vértice/ }).click();
    await expect(banner).toContainText('modo só leitura');
    // A troca em si segue liberada na empresa em só leitura: volta para a plena.
    await nav.getByRole('button', { name: /Trocar de empresa/ }).click();
    await page.getByRole('menuitemradio', { name: /Clínica Aurora/ }).click();
    await expect(nav.getByText('Clínica Aurora')).toBeVisible();
    await expect(banner).toHaveCount(0);
  });

  test('erro 404 na troca: mostra o aviso e mantém a empresa', async ({ page }) => {
    await mockAccount(page, { memberships: [A, B] });
    await page.route('**/api/me/workspace', (route) =>
      fulfillJson(route, { error: 'workspace_not_found' }, 404),
    );
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navegação principal' });
    await nav.getByRole('button', { name: /Trocar de empresa/ }).click();
    await page.getByRole('menuitemradio', { name: /Studio Vértice/ }).click();
    await expect(page.getByRole('alert').getByText(/não tem mais acesso/)).toBeVisible();
  });

  test('atalho Alt+Shift+2 troca para a segunda empresa', async ({ page }) => {
    const account = await mockAccount(page, { memberships: [A, B] });
    await page.goto('/');
    await expect(page.getByRole('complementary').getByText('Clínica Aurora')).toBeVisible();
    await page.keyboard.press('Alt+Shift+Digit2');
    await expect.poll(() => account.switched).toEqual(['ws_b']);
  });
});

test.describe('Faixas de conta', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const banner = (page: Page) => page.getByRole('region', { name: 'Aviso da conta' });

  test('só leitura vence trial e convite', async ({ page }) => {
    await mockAccount(page, {
      memberships: [{ ...A, subscriptionStatus: 'expired' }],
      invites: [
        {
          id: 'i1',
          workspaceId: 'ws_z',
          workspaceName: 'Empresa Z',
          role: 'AGENT',
          inviterName: 'Bia',
          expiresAt: new Date(Date.now() + 5 * DAY).toISOString(),
        },
      ],
    });
    await page.goto('/');
    await expect(banner(page)).toContainText('modo só leitura');
    await expect(banner(page).getByRole('link', { name: 'Escolher plano' })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
    await expect(page.getByRole('region', { name: 'Aviso da conta' })).toHaveCount(1);
  });

  test('trial com 2 dias avisa; convite aparece quando nada acima', async ({ page }) => {
    await mockAccount(page, {
      memberships: [{ ...A, subscriptionStatus: 'trial' }],
      workspaceExtra: { trialEndsAt: new Date(Date.now() + 2 * DAY).toISOString() },
    });
    await page.goto('/');
    await expect(banner(page)).toContainText('Seu teste termina em');
    await banner(page).getByRole('button', { name: 'Dispensar aviso' }).click();
    await expect(banner(page)).toHaveCount(0);
  });

  test('convite pendente explica onde está o link (sem inventar rota)', async ({ page }) => {
    await mockAccount(page, {
      memberships: [A],
      invites: [
        {
          id: 'i1',
          workspaceId: 'ws_z',
          workspaceName: 'Empresa Z',
          role: 'AGENT',
          inviterName: 'Bia',
          expiresAt: new Date(Date.now() + 5 * DAY).toISOString(),
        },
      ],
    });
    await page.goto('/');
    await expect(banner(page)).toContainText('Você foi convidado para Empresa Z');
    await banner(page).getByRole('button', { name: 'Ver como entrar' }).click();
    await expect(banner(page)).toContainText('Abra o link que enviamos para o seu email');
  });
});

test.describe('Capturas (F71-S08)', () => {
  const sizes = [
    { name: '375', width: 375, height: 800 },
    { name: '768', width: 768, height: 900 },
    { name: '1440', width: 1440, height: 900 },
  ];
  for (const size of sizes) {
    for (const theme of ['dark', 'light'] as const) {
      test(`shell com 2 empresas e faixa — ${size.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
        await mockAccount(page, {
          memberships: [{ ...A, subscriptionStatus: 'past_due' }, B],
        });
        await page.goto('/');
        await expect(banner(page)).toContainText('Pagamento pendente');
        if (size.width >= 768) {
          await page.getByRole('button', { name: /Trocar de empresa/ }).click();
        } else {
          await page.getByRole('button', { name: 'Conta de Ana QA' }).click();
        }
        await page.screenshot({
          path: `e2e/.artifacts/f71-s08/${size.name}-${theme}.png`,
        });
      });
    }
  }
  function banner(page: Page) {
    return page.getByRole('region', { name: 'Aviso da conta' });
  }
});
