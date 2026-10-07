/**
 * F71-S10 — seção Membros do admin (API mockada): convidar, reenviar, copiar link, revogar,
 * limite de vagas e empresa em só leitura (402). O que a spec trava:
 *  - o corpo do convite (email normalizado + papel; OWNER nunca é oferecido);
 *  - o link copiado nasce de um POST (troca o token) e vai pelo clipboard, com plano B manual;
 *  - 402 `seat_limit` mostra o CTA de plano e 402 `subscription_inactive` não desloga.
 */

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';

const DAY = 86_400_000;

interface InviteSeed {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  lastSentAt: string | null;
  sendCount: number;
  resendsLeft: number;
}

const inviteRow = (over: Partial<InviteSeed> & Pick<InviteSeed, 'id' | 'email'>): InviteSeed => ({
  role: 'AGENT',
  createdAt: new Date(Date.now() - DAY).toISOString(),
  expiresAt: new Date(Date.now() + 6 * DAY).toISOString(),
  expired: false,
  lastSentAt: new Date(Date.now() - DAY).toISOString(),
  sendCount: 1,
  resendsLeft: 2,
  ...over,
});

const MEMBERS = [
  {
    id: 'mem_owner_e2e',
    email: 'ana@acme.com',
    name: 'Ana QA',
    role: 'OWNER',
    status: 'active',
    avatarUrl: null,
    isOnline: true,
    lastSeenAt: null,
    createdAt: '2026-06-01T12:00:00.000Z',
  },
];

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

interface Calls {
  created: unknown[];
  resent: string[];
  linked: string[];
  revoked: string[];
}

interface Options {
  invites?: InviteSeed[];
  seats?: { used: number; limit: number | null };
  /** Resposta do POST de convite (por padrão 201 enviado). */
  createResponse?: (body: { email: string; role: string }) => { status: number; body: unknown };
  me?: Record<string, unknown>;
}

async function mockMembers(page: Page, opts: Options = {}): Promise<Calls> {
  const calls: Calls = { created: [], resent: [], linked: [], revoked: [] };
  let invites = opts.invites ?? [inviteRow({ id: 'inv_1', email: 'bia@acme.com' })];
  const seats = opts.seats ?? { used: 2, limit: 5 };

  if (opts.me) await page.route('**/api/me', (route) => json(route, opts.me));
  await page.route('**/api/departments', (route) => json(route, { departments: [] }));
  await page.route('**/api/members**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path === '/api/members' && method === 'GET') return json(route, { members: MEMBERS });
    if (path === '/api/members/invites' && method === 'GET') return json(route, { invites, seats });
    if (path === '/api/members/invites' && method === 'POST') {
      const body = req.postDataJSON() as { email: string; role: string };
      calls.created.push(body);
      const custom = opts.createResponse?.(body);
      if (custom) return json(route, custom.body, custom.status);
      const invite = inviteRow({ id: `inv_${calls.created.length + 1}`, email: body.email, role: body.role });
      invites = [invite, ...invites];
      return json(route, { invite, delivery: 'sent' }, 201);
    }
    const match = /^\/api\/members\/invites\/([^/]+)(?:\/(resend|link))?$/.exec(path);
    if (match) {
      const [, id = '', action] = match;
      const invite = invites.find((i) => i.id === id);
      if (!invite) return json(route, { error: 'invite_not_found' }, 404);
      if (method === 'POST' && action === 'resend') {
        calls.resent.push(id);
        return json(route, { invite: { ...invite, sendCount: invite.sendCount + 1 }, delivery: 'sent' });
      }
      if (method === 'POST' && action === 'link') {
        calls.linked.push(id);
        return json(route, {
          url: `https://app.test/convite/novo-token-${calls.linked.length}`,
          expiresAt: invite.expiresAt,
          invite,
        });
      }
      if (method === 'DELETE' && !action) {
        calls.revoked.push(id);
        invites = invites.filter((i) => i.id !== id);
        return route.fulfill({ status: 204 });
      }
    }
    return json(route, { error: 'not_mocked' }, 404);
  });
  return calls;
}

const OPEN_MEMBERS = '/settings?s=membros';

test.describe('Membros — convites (admin)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('convida: email normalizado + papel, sem OWNER na lista, toast e linha nova', async ({ page }) => {
    const calls = await mockMembers(page);
    await page.goto(OPEN_MEMBERS);
    await expect(page.getByText('2 de 5 vagas em uso')).toBeVisible();

    await page.getByRole('button', { name: 'Convidar membro' }).first().click();
    const dialog = page.getByRole('dialog');
    const roles = await dialog.getByLabel('Papel').locator('option').allTextContents();
    expect(roles).not.toContain('Proprietário');
    expect(roles).toEqual(['Administrador', 'Supervisor', 'Atendente', 'Somente leitura']);

    // Email inválido: barrado no formulário, sem chamar a API.
    await dialog.getByLabel('Email').fill('isto-nao-e-email');
    await dialog.getByRole('button', { name: 'Enviar convite' }).click();
    await expect(dialog.getByText('Informe um email válido')).toBeVisible();
    expect(calls.created).toHaveLength(0);

    await dialog.getByLabel('Email').fill('  Carla@Acme.com ');
    await dialog.getByLabel('Papel').selectOption('SUPERVISOR');
    await dialog.getByRole('button', { name: 'Enviar convite' }).click();

    await expect(page.getByText('Convite enviado para carla@acme.com')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.created).toEqual([{ email: 'carla@acme.com', role: 'SUPERVISOR' }]);
    await expect(page.getByText('carla@acme.com', { exact: true })).toBeVisible();
  });

  test('delivery failed: avisa que o email não saiu e manda copiar o link', async ({ page }) => {
    await mockMembers(page, {
      createResponse: (b) => ({
        status: 201,
        body: { invite: inviteRow({ id: 'inv_f', email: b.email, role: b.role }), delivery: 'failed' },
      }),
    });
    await page.goto(OPEN_MEMBERS);
    await page.getByRole('button', { name: 'Convidar membro' }).first().click();
    await page.getByRole('dialog').getByLabel('Email').fill('dora@acme.com');
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar convite' }).click();
    await expect(page.getByText('Convite criado, mas o email não saiu')).toBeVisible();
    await expect(page.getByText('Convite enviado para dora@acme.com')).toHaveCount(0);
  });

  test('reenviar: POST na linha certa e toast de reenvio', async ({ page }) => {
    const calls = await mockMembers(page);
    await page.goto(OPEN_MEMBERS);
    await page.getByRole('button', { name: 'Reenviar convite para bia@acme.com' }).click();
    await expect(page.getByText('Convite reenviado para bia@acme.com')).toBeVisible();
    expect(calls.resent).toEqual(['inv_1']);
  });

  test('reenviar sem reenvios restantes: botão desabilitado (copiar link segue possível)', async ({
    page,
  }) => {
    await mockMembers(page, { invites: [inviteRow({ id: 'inv_1', email: 'bia@acme.com', resendsLeft: 0 })] });
    await page.goto(OPEN_MEMBERS);
    await expect(page.getByRole('button', { name: 'Reenviar convite para bia@acme.com' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Copiar link do convite de bia@acme.com' })).toBeEnabled();
  });

  test('copiar link: POST troca o token e o link novo vai para a área de transferência', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t: string) => (w.__copied.push(t), Promise.resolve()) },
      });
    });
    const calls = await mockMembers(page);
    await page.goto(OPEN_MEMBERS);
    await page.getByRole('button', { name: 'Copiar link do convite de bia@acme.com' }).click();
    await expect(page.getByText('Link copiado')).toBeVisible();
    await expect(page.getByText('O link anterior deste convite deixou de valer.')).toBeVisible();
    expect(calls.linked).toEqual(['inv_1']);
    const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
    expect(copied).toEqual(['https://app.test/convite/novo-token-1']);
  });

  test('copiar link com clipboard recusado: mostra o link para copiar à mão', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
    });
    await mockMembers(page);
    await page.goto(OPEN_MEMBERS);
    await page.getByRole('button', { name: 'Copiar link do convite de bia@acme.com' }).click();
    const dialog = page.getByRole('dialog', { name: 'Copie o link do convite' });
    await expect(dialog.getByLabel('Link do convite')).toHaveValue('https://app.test/convite/novo-token-1');
  });

  test('revogar: pede confirmação, cancelar não chama a API, confirmar remove a linha', async ({ page }) => {
    const calls = await mockMembers(page);
    await page.goto(OPEN_MEMBERS);
    await page.getByRole('button', { name: /Revogar convite de bia@acme.com|Revogar/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Revogar convite' });
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    expect(calls.revoked).toEqual([]);
    await expect(page.getByText('bia@acme.com', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Revogar/ }).first().click();
    await page.getByRole('dialog', { name: 'Revogar convite' }).getByRole('button', { name: 'Revogar convite' }).click();
    await expect(page.getByText('Convite revogado')).toBeVisible();
    expect(calls.revoked).toEqual(['inv_1']);
    await expect(page.getByText('bia@acme.com', { exact: true })).toHaveCount(0);
  });

  test('plano cheio: 402 seat_limit mostra o aviso com CTA para os planos', async ({ page }) => {
    await mockMembers(page, {
      seats: { used: 5, limit: 5 },
      createResponse: () => ({ status: 402, body: { error: 'seat_limit', used: 5, limit: 5 } }),
    });
    await page.goto(OPEN_MEMBERS);
    await expect(page.getByText('5 de 5 vagas em uso')).toBeVisible();
    await page.getByRole('button', { name: 'Convidar membro' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill('extra@acme.com');
    await dialog.getByRole('button', { name: 'Enviar convite' }).click();
    await expect(dialog.getByText('Limite de membros atingido')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Ver planos' })).toHaveAttribute('href', '/settings/billing');
  });

  test('empresa em só leitura: faixa visível; 402 subscription_inactive explica sem deslogar', async ({
    page,
  }) => {
    const me = {
      member: { id: 'mem_owner_e2e', workspaceId: 'ws_a', name: 'Ana QA', role: 'OWNER', status: 'active' },
      workspace: { id: 'ws_a', name: 'Acme', subscriptionStatus: 'expired', trialEndsAt: null },
      memberships: [
        { workspaceId: 'ws_a', name: 'Acme', slug: 'acme', role: 'OWNER', subscriptionStatus: 'expired' },
      ],
    };
    await mockMembers(page, {
      me,
      createResponse: () => ({
        status: 402,
        body: { error: 'subscription_inactive', message: 'Assinatura inativa.' },
      }),
    });
    await page.goto(OPEN_MEMBERS);
    const banner = page.getByRole('region', { name: 'Aviso da conta' });
    await expect(banner).toContainText('modo só leitura');
    await expect(banner.getByRole('link', { name: 'Escolher plano' })).toHaveAttribute(
      'href',
      '/settings/billing',
    );

    await page.getByRole('button', { name: 'Convidar membro' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill('nova@acme.com');
    await dialog.getByRole('button', { name: 'Enviar convite' }).click();
    // O handler central explica UMA vez e a sessão continua de pé (sem ir para /login).
    await expect(page.getByText('Sua empresa está em modo só leitura').first()).toBeVisible();
    await expect(page).toHaveURL(/\/settings/);
    await expect(banner).toBeVisible();
  });
});
