/**
 * Calendar 2.0 — fluxos-chave da agenda (F37-S05).
 *
 * Cobre o desktop (a página delega para a agenda mobile só sob breakpoint mobile;
 * o viewport padrão do projeto `chromium` é Desktop Chrome → renderiza a trilha +
 * a grade FullCalendar):
 *
 *   1) Trilha multi-calendário liga/desliga (overlay): cada calendário é uma
 *      linha-checkbox com cor; desligar um remove seus eventos da grade, religar
 *      os traz de volta — a seleção é o que alimenta `GET /api/events?calendarIds=`.
 *   2) Criar evento (incl. RECORRENTE) pelo form 2.0: título, calendário, repetição
 *      semanal → POST /api/events com `recurrenceRule`. Asserta o payload de wire.
 *   3) Abrir o detalhe de um evento (clique na grade → modal de detalhe).
 *
 * Hermético: estende a fixture `test` (auth + mocks base já ligados) e registra
 * ANTES do catch-all de API (rota glob `api` da fixture) as rotas de calendar com
 * estado local stateful — nenhuma API/DB real precisa estar de pé. A precedência
 * do Playwright é a da última rota registrada, então estas vencem o fallback
 * genérico da fixture.
 *
 * AMBIENTE (honestidade — ver memória `e2e-no-hydration-this-host`): neste host
 * Windows o bundle cliente do Next NÃO hidrata no headless-shell, então NENHUM
 * spec e2e do projeto fica verde aqui (inclusive os antigos). Este spec é validado
 * por `pnpm typecheck`/`tsc` e deve rodar verde num host onde o app hidrata. NÃO
 * marcamos verde de execução localmente.
 */

import type { Route, Request, Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { ME } from './fixtures/seed';

// ── Cenário: 1 pessoal + 1 Empresa, cada um com 1 evento ─────────────────────
// IDs UUID v4 válidos (o form 2.0 valida `calendarId` com z.string().uuid()).

const CAL_PERSONAL = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Meu calendário',
  type: 'personal' as const,
  color: '#1FFF13',
};
const CAL_WORKSPACE = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Empresa',
  type: 'workspace' as const,
  color: '#7c3aed',
};

function calendarRow(c: { id: string; name: string; type: string; color: string }) {
  return {
    id: c.id,
    workspaceId: ME.workspace.id,
    name: c.name,
    type: c.type,
    ownerId: c.type === 'personal' ? ME.member.id : null,
    teamId: null,
    color: c.color,
    description: null,
    timezone: 'America/Sao_Paulo',
    isDefault: c.type === 'workspace',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: null,
  };
}

interface EventSeed {
  id: string;
  calendarId: string;
  title: string;
  type: string;
  startAt: string;
  endAt: string;
  recurrenceRule: string | null;
}

function eventRow(e: EventSeed) {
  return {
    id: e.id,
    workspaceId: ME.workspace.id,
    calendarId: e.calendarId,
    title: e.title,
    description: null,
    type: e.type,
    startAt: e.startAt,
    endAt: e.endAt,
    status: 'scheduled',
    location: null,
    meetingUrl: null,
    contactId: null,
    dealId: null,
    conversationId: null,
    createdBy: ME.member.id,
    createdByAgentId: null,
    recurrenceRule: e.recurrenceRule,
    recurrenceUntil: null,
    recurrenceParentId: null,
    metadata: {},
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: null,
  };
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function parseBody(request: Request): Record<string, unknown> {
  const raw = request.postData();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** `?calendarIds=a,b` → conjunto pedido. */
function requestedCalendarIds(url: string): Set<string> {
  const value = new URL(url).searchParams.get('calendarIds');
  if (!value) return new Set();
  return new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
}

test.describe('Calendar 2.0 — agenda multi-calendário', () => {
  /**
   * Instala as rotas de calendar com estado local. Devolve um getter do nº de
   * eventos criados por POST (para asserção de criação).
   */
  async function installCalendarRoutes(page: Page) {
    // Seed: 1 evento por calendário, numa janela conhecida (a grade abre na semana corrente;
    // o filtro server-side é simulado pelo `calendarIds` pedido — não pela janela, que a UI
    // controla e cujos limites variam com "hoje". Devolvemos sempre os eventos do conjunto
    // pedido e deixamos o FullCalendar posicioná-los pela data — por isso usamos datas
    // próximas de "agora" calculadas em runtime).
    const now = new Date();
    const at = (dayOffset: number, hour: number): string => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + dayOffset);
      d.setUTCHours(hour, 0, 0, 0);
      return d.toISOString();
    };

    const seeded: EventSeed[] = [
      {
        id: 'aaaaaaaa-1111-4111-8111-111111111111',
        calendarId: CAL_PERSONAL.id,
        title: 'Evento Pessoal QA',
        type: 'meeting',
        startAt: at(0, 14),
        endAt: at(0, 15),
        recurrenceRule: null,
      },
      {
        id: 'bbbbbbbb-2222-4222-8222-222222222222',
        calendarId: CAL_WORKSPACE.id,
        title: 'Reunião da Empresa QA',
        type: 'meeting',
        startAt: at(1, 10),
        endAt: at(1, 11),
        recurrenceRule: null,
      },
    ];

    const created: Record<string, unknown>[] = [];

    // GET/POST /api/events — escopado pelo `calendarIds` pedido (espelha o overlay real).
    await page.route(/\/api\/events(\?.*)?$/, async (route: Route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        const wanted = requestedCalendarIds(request.url());
        const visible = [...seeded, ...created.map((c) => c as unknown as EventSeed)].filter(
          (e) => wanted.size === 0 || wanted.has(e.calendarId),
        );
        return json(route, { events: visible.map((e) => eventRow(e)) });
      }
      if (request.method() === 'POST') {
        const body = parseBody(request);
        const e: EventSeed = {
          id: `cccccccc-3333-4333-8333-${String(created.length + 1).padStart(12, '0')}`,
          calendarId: String(body['calendarId'] ?? CAL_PERSONAL.id),
          title: String(body['title'] ?? 'Novo evento'),
          type: String(body['type'] ?? 'meeting'),
          startAt: String(body['startAt'] ?? at(2, 9)),
          endAt: String(body['endAt'] ?? at(2, 10)),
          recurrenceRule:
            typeof body['recurrenceRule'] === 'string' ? body['recurrenceRule'] : null,
        };
        created.push(e as unknown as Record<string, unknown>);
        return json(route, { event: eventRow(e) }, 201);
      }
      return route.fallback();
    });

    // GET /api/events/:id — detalhe + participantes (para o modal de detalhe).
    await page.route(/\/api\/events\/[^/?]+$/, async (route: Route) => {
      const request = route.request();
      if (request.method() !== 'GET') return route.fallback();
      const id = new URL(request.url()).pathname.split('/').pop() ?? '';
      const all = [...seeded, ...created.map((c) => c as unknown as EventSeed)];
      const found = all.find((e) => e.id === id) ?? seeded[0]!;
      return json(route, {
        event: eventRow(found),
        participants: [
          {
            id: 'pppppppp-1111-4111-8111-111111111111',
            eventId: found.id,
            memberId: ME.member.id,
            contactId: null,
            role: 'organizer',
            rsvp: 'accepted',
            notifiedAt: null,
          },
        ],
      });
    });

    // GET /api/calendars — a trilha lista pessoal + Empresa (ambos acessíveis ao OWNER).
    await page.route(/\/api\/calendars(\?.*)?$/, (route: Route) =>
      json(route, { calendars: [calendarRow(CAL_WORKSPACE), calendarRow(CAL_PERSONAL)] }),
    );

    // GET /api/members — seletor de participantes do form 2.0.
    await page.route(/\/api\/members(\?.*)?$/, (route: Route) =>
      json(route, {
        members: [
          { id: ME.member.id, name: ME.member.name, email: 'owner@dev.local', avatarUrl: null },
        ],
      }),
    );

    return { createdCount: () => created.length, created };
  }

  test('trilha liga/desliga calendários e sobrepõe seus eventos (overlay)', async ({ page }) => {
    await installCalendarRoutes(page);
    await page.goto('/calendar');

    // A trilha lista os dois calendários como linha-checkbox (role=checkbox).
    const empresa = page.getByRole('checkbox', { name: CAL_WORKSPACE.name });
    const pessoal = page.getByRole('checkbox', { name: CAL_PERSONAL.name });
    await expect(empresa).toBeVisible();
    await expect(pessoal).toBeVisible();

    // Primeira visita → todos ligados (aria-checked=true) e os eventos de ambos aparecem.
    await expect(empresa).toHaveAttribute('aria-checked', 'true');
    await expect(pessoal).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Evento Pessoal QA')).toBeVisible();
    await expect(page.getByText('Reunião da Empresa QA')).toBeVisible();

    // Desliga o pessoal → some da grade; a Empresa permanece (overlay independente).
    await pessoal.click();
    await expect(pessoal).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Evento Pessoal QA')).toHaveCount(0);
    await expect(page.getByText('Reunião da Empresa QA')).toBeVisible();

    // Religa → volta.
    await pessoal.click();
    await expect(pessoal).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Evento Pessoal QA')).toBeVisible();
  });

  test('cria evento recorrente via form 2.0 (POST envia recurrenceRule)', async ({ page }) => {
    const ctx = await installCalendarRoutes(page);
    await page.goto('/calendar');
    await expect(page.getByRole('checkbox', { name: CAL_PERSONAL.name })).toBeVisible();

    // Abre o form de criação pelo botão "Novo evento" (gated por event.edit; OWNER tem).
    await page.getByRole('button', { name: 'Novo evento' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Novo evento')).toBeVisible();

    // Preenche título + início/fim + repetição semanal.
    await dialog.getByPlaceholder('Reunião com…').fill('Daily QA Sync');
    await dialog.locator('input[type="datetime-local"]').first().fill('2026-07-01T09:00');
    await dialog.locator('input[type="datetime-local"]').last().fill('2026-07-01T09:30');

    // Campo "Repetir" → "Toda semana" (gera FREQ=WEEKLY).
    const repeat = dialog.locator('select').filter({ hasText: 'Não se repete' });
    await repeat.selectOption({ label: 'Toda semana' });

    await dialog.getByRole('button', { name: 'Criar' }).click();

    // Confirma o efeito: toast de sucesso + exatamente 1 POST com recurrenceRule semanal.
    await expect(page.getByText('Evento criado.')).toBeVisible();
    expect(ctx.createdCount()).toBe(1);
    const last = ctx.created[ctx.created.length - 1]!;
    expect(last['title']).toBe('Daily QA Sync');
    expect(String(last['recurrenceRule'])).toContain('FREQ=WEEKLY');
  });

  test('cria evento simples (sem recorrência) via form 2.0', async ({ page }) => {
    const ctx = await installCalendarRoutes(page);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Novo evento' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Reunião com…').fill('Café com o time');
    await dialog.locator('input[type="datetime-local"]').first().fill('2026-07-02T15:00');
    await dialog.locator('input[type="datetime-local"]').last().fill('2026-07-02T16:00');
    await dialog.getByRole('button', { name: 'Criar' }).click();

    await expect(page.getByText('Evento criado.')).toBeVisible();
    expect(ctx.createdCount()).toBe(1);
    expect(ctx.created[0]!['recurrenceRule']).toBeNull();
  });

  test('abre o detalhe de um evento ao clicar na grade', async ({ page }) => {
    await installCalendarRoutes(page);
    await page.goto('/calendar');

    const event = page.getByText('Reunião da Empresa QA');
    await expect(event).toBeVisible();
    await event.click();

    // O modal de detalhe abre com o título do evento.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Reunião da Empresa QA')).toBeVisible();
  });
});
