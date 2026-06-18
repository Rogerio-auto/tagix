/**
 * Mobile — inbox / cockpit (F36-S14, MOBILE_UX §2 "Cockpit/inbox").
 *
 * Fluxo-chave em viewport mobile (Pixel): a ESTRUTURA vira pilha de views
 * (Lista → Thread → Cockpit), não 3 colunas. A lista abre a thread em tela
 * cheia; o botão "voltar" volta para a lista; o Cockpit (ContactInfoPanel) abre
 * como full-`Sheet` por cima e dentro dele se troca o agente de IA (AgentSelector
 * vira lista num Sheet no mobile, não dropdown).
 *
 * HERMÉTICO: estende a fixture `test`; registra rotas locais (precedência sobre
 * o fallback genérico) para detalhe da conversa + agente + troca. Viewport mobile
 * por `test.use`.
 *
 * AMBIENTE: ver nota de hidratação em `mobile-navigation.spec.ts` — execução e2e
 * pendente de host que hidrata; aqui garantimos specs VÁLIDOS (typecheck).
 */

import { devices } from '@playwright/test';
import type { Page, Route, Request } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { CONVERSATION, ME } from './fixtures/seed';

test.use({ ...devices['Pixel 5'] });

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

const DETAIL = {
  id: CONVERSATION.id,
  contactId: CONVERSATION.contactId,
  channelId: CONVERSATION.channelId,
  channelProvider: 'whatsapp',
  remoteId: CONVERSATION.remoteId,
  kind: 'whatsapp',
  status: 'open',
  aiMode: 'on',
  aiPausedReason: null,
  aiPausedAt: null,
  assignedTo: ME.member.id,
  assignedToName: ME.member.name,
  departmentId: 'dept_vendas',
  departmentName: 'Vendas',
  agentId: 'agent_sdr',
  agentName: 'SDR Bot',
  stageName: null,
  unreadCount: 0,
  lastMessageAt: '2026-06-12T13:00:00.000Z',
  createdAt: '2026-06-12T12:00:00.000Z',
  updatedAt: '2026-06-12T13:00:00.000Z',
} as const;

const CANDIDATES = [
  { id: 'agent_sdr', name: 'SDR Bot' },
  { id: 'agent_closer', name: 'Closer Bot' },
];

/**
 * Rotas locais do cockpit/agente. Estado mutável do agente atual para a asserção
 * da troca. Devolve um getter do nº de POSTs de troca de agente recebidos.
 */
async function installInboxRoutes(page: Page) {
  let currentAgentId = 'agent_sdr';
  let agentAssignments = 0;

  // GET /api/conversations/:id → detalhe (header da thread + cockpit).
  await page.route(/\/api\/conversations\/[^/]+$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return json(route, { conversation: DETAIL });
  });

  // GET /api/conversations/:id/agent + POST (trocar agente, re-engaja a IA).
  await page.route(/\/api\/conversations\/[^/]+\/agent$/, (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      const current = CANDIDATES.find((c) => c.id === currentAgentId) ?? null;
      return json(route, {
        currentAgentId,
        currentAgentName: current?.name ?? null,
        candidates: CANDIDATES,
      });
    }
    if (request.method() === 'POST') {
      const body = parseBody(request);
      const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : currentAgentId;
      currentAgentId = agentId;
      agentAssignments += 1;
      return json(route, { conversationId: CONVERSATION.id, agentId });
    }
    return route.fallback();
  });

  return { assignments: () => agentAssignments, currentAgentId: () => currentAgentId };
}

test.describe('Mobile — inbox em pilha de views', () => {
  test('lista → thread → voltar preserva a pilha de views', async ({ page }) => {
    await installInboxRoutes(page);
    await page.goto('/conversations');

    // Lista em tela cheia: o item da conversa pelo remoteId exibido.
    const item = page
      .getByRole('list', { name: 'Conversas' })
      .getByRole('link')
      .filter({ hasText: CONVERSATION.remoteId });
    await expect(item).toBeVisible();
    await item.click();

    // Abre a thread em tela cheia: header compacto com "voltar" + abrir cockpit.
    await expect(page).toHaveURL(new RegExp(`/conversations/${CONVERSATION.id}$`));
    const back = page.getByRole('button', { name: 'Voltar para a lista de conversas' });
    await expect(back).toBeVisible();

    // O composer fixo no rodapé (thumb-first) está presente.
    await expect(page.getByPlaceholder('Escreva uma mensagem…')).toBeVisible();

    // "Voltar" volta para a lista (router.back preserva o histórico/estado).
    await back.click();
    await expect(page).toHaveURL(/\/conversations$/);
    await expect(item).toBeVisible();
  });

  test('abre o Cockpit como full-sheet e troca o agente de IA', async ({ page }) => {
    const ctx = await installInboxRoutes(page);
    await page.goto(`/conversations/${CONVERSATION.id}`);

    // Abre o Cockpit (ContactInfoPanel) — full-sheet por cima da thread (§2.3).
    await page.getByRole('button', { name: 'Abrir cockpit da conversa' }).click();
    const cockpit = page.getByRole('dialog', { name: 'Cockpit' });
    await expect(cockpit).toBeVisible();

    // Dentro do cockpit, o agente atual aparece nomeado (não só "IA on/off").
    const agentTrigger = cockpit.getByRole('button', { name: /SDR Bot/ });
    await expect(agentTrigger).toBeVisible();
    await agentTrigger.click();

    // No mobile a lista de candidatos vive num Sheet (não dropdown) → escolhe outro.
    const picker = page.getByRole('dialog', { name: 'Selecionar agente' });
    await expect(picker).toBeVisible();
    await picker.getByRole('option', { name: 'Closer Bot' }).click();

    // Efeito de negócio: exatamente 1 POST de troca + agente atual atualizado.
    await expect(page.getByText('Agente alterado para Closer Bot')).toBeVisible();
    expect(ctx.assignments()).toBe(1);
    expect(ctx.currentAgentId()).toBe('agent_closer');
  });
});
