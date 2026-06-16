/**
 * Roteamento agente-de-IA ↔ departamento + troca manual no cockpit (F34-S07).
 *
 * Caminho determinístico (sem LLM real / sem transferência autônoma — essa é
 * coberta por unit em F34-S05/S06):
 *
 *   1) O owner já associou um agente a um departamento e o marcou como ENTRADA
 *      (default do dept). No backend isso vive em `agent_departments.is_default`.
 *      Aqui modelamos o efeito visível: a conversa daquele departamento, com
 *      `ai_mode='on'`, já resolveu para o agente de entrada (S03 persiste o
 *      `conversation.agent_id` sticky). O cockpit mostra esse agente atual.
 *   2) O operador (OWNER, tem `conversation.assign_agent`) abre o cockpit, vê o
 *      agente responsável NOMEADO no `AgentSelector` e TROCA para outro agente
 *      elegível ao departamento (S04: `POST /api/conversations/:id/agent`).
 *   3) A troca reflete: o `currentAgentName` exibido passa a ser o novo agente.
 *
 * Hermético: estende a fixture `test` (mocks de auth/me/socket já ligados) e
 * sobrescreve apenas os endpoints de detalhe e de agente da conversa com um
 * estado stateful local — nenhuma API/runtime real precisa estar de pé. Não
 * tocamos `fixtures/api-mock.ts` (fronteira do slot); registramos as rotas
 * específicas aqui, e o Playwright dá precedência à última rota registrada.
 */

import type { Route, Request } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { CONVERSATION, ME } from './fixtures/seed';

// ── Cenário: 1 departamento "Suporte", 2 agentes elegíveis ───────────────────

const DEPARTMENT = { id: 'dept_support_e2e', name: 'Suporte' } as const;

/** Agente de ENTRADA do departamento (default do dept → resolvido pela IA em S03). */
const ENTRY_AGENT = { id: '11111111-1111-4111-8111-111111111111', name: 'Aurora (Suporte)' } as const;
/** Outro agente elegível ao mesmo departamento (alvo da troca manual). */
const OTHER_AGENT = { id: '22222222-2222-4222-8222-222222222222', name: 'Atlas (Vendas)' } as const;

const CANDIDATES = [ENTRY_AGENT, OTHER_AGENT];

/** Detalhe da conversa servido ao cockpit — departamento setado + IA on. */
function conversationDetail(agentId: string) {
  return {
    id: CONVERSATION.id,
    contactId: CONVERSATION.contactId,
    channelId: CONVERSATION.channelId,
    channelProvider: 'meta_whatsapp',
    remoteId: CONVERSATION.remoteId,
    kind: CONVERSATION.kind,
    status: 'open',
    aiMode: 'on',
    aiPausedReason: null,
    aiPausedAt: null,
    assignedTo: ME.member.id,
    assignedToName: ME.member.name,
    departmentId: DEPARTMENT.id,
    departmentName: DEPARTMENT.name,
    agentId,
    stageName: null,
    unreadCount: 0,
    lastMessageAt: '2026-06-12T13:00:00.000Z',
    createdAt: '2026-06-12T12:00:00.000Z',
    updatedAt: '2026-06-12T13:00:00.000Z',
  };
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

test.describe('Roteamento agente ↔ departamento', () => {
  test('IA resolve o agente de entrada do dept e o operador troca no cockpit', async ({
    page,
  }) => {
    // Estado local da conversa: começa no agente de ENTRADA resolvido pela IA (S03).
    let currentAgentId: string = ENTRY_AGENT.id;
    let assignCalls = 0;

    // GET /api/conversations/:id/agent — agente atual + candidatos elegíveis ao dept.
    // (Registrada ANTES do catch-all `**/api/**` da fixture ⇒ tem precedência.)
    await page.route(
      new RegExp(`/api/conversations/${CONVERSATION.id}/agent$`),
      async (route: Route) => {
        const request = route.request();
        const currentName =
          CANDIDATES.find((c) => c.id === currentAgentId)?.name ?? null;

        if (request.method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              currentAgentId,
              currentAgentName: currentName,
              candidates: CANDIDATES,
            }),
          });
        }

        if (request.method() === 'POST') {
          assignCalls += 1;
          const body = parseBody(request);
          const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : '';
          // Elegibilidade: o alvo precisa atender o departamento da conversa (S04).
          if (!CANDIDATES.some((c) => c.id === agentId)) {
            return route.fulfill({
              status: 422,
              contentType: 'application/json',
              body: JSON.stringify({
                message: 'Agente não elegível ao departamento da conversa.',
              }),
            });
          }
          currentAgentId = agentId;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ conversationId: CONVERSATION.id, agentId }),
          });
        }

        return route.fallback();
      },
    );

    // GET /api/conversations/:id — detalhe servido ao cockpit (dept + ai_mode='on').
    await page.route(
      new RegExp(`/api/conversations/${CONVERSATION.id}$`),
      async (route: Route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ conversation: conversationDetail(currentAgentId) }),
          });
        }
        return route.fallback();
      },
    );

    // ── Abre a conversa do departamento "Suporte" ─────────────────────────────
    await page.goto(`/conversations/${CONVERSATION.id}`);

    // ── Abre o cockpit (botão Info do header) ─────────────────────────────────
    await page.getByRole('button', { name: 'Abrir painel de informações' }).click();
    await expect(page.getByRole('complementary', { name: 'Cockpit da conversa' })).toBeVisible();

    // ── 1) Resolução por dept: o agente de ENTRADA é o responsável atual ──────
    // O gatilho do seletor é o único botão com `aria-haspopup="listbox"` (AgentSelector).
    const selector = page.locator('button[aria-haspopup="listbox"]');
    await expect(selector).toBeVisible();
    await expect(selector).toContainText(ENTRY_AGENT.name);

    // O dept da conversa também aparece no contexto do cockpit.
    await expect(
      page.getByRole('complementary', { name: 'Cockpit da conversa' }),
    ).toContainText(DEPARTMENT.name);

    // ── 2) Operador abre o dropdown e troca para o OUTRO agente do dept ───────
    await selector.click();
    const listbox = page.getByRole('listbox', { name: 'Selecionar agente' });
    await expect(listbox).toBeVisible();
    // Ambos os candidatos elegíveis ao dept aparecem.
    await expect(listbox.getByRole('option', { name: new RegExp(ENTRY_AGENT.name) })).toBeVisible();
    const otherOption = listbox.getByRole('option', { name: new RegExp(OTHER_AGENT.name) });
    await expect(otherOption).toBeVisible();

    await otherOption.click();

    // ── 3) A troca reflete: toast + o agente atual passa a ser o novo ─────────
    await expect(page.getByText(`Agente alterado para ${OTHER_AGENT.name}`)).toBeVisible();
    await expect(selector).toContainText(OTHER_AGENT.name);

    // O endpoint de troca foi chamado exatamente uma vez (idempotência da UI:
    // re-clicar no já selecionado é no-op — coberto abaixo).
    expect(assignCalls).toBe(1);

    // ── 4) Re-selecionar o agente já atual NÃO dispara nova troca (no-op UI) ──
    await selector.click();
    await page
      .getByRole('listbox', { name: 'Selecionar agente' })
      .getByRole('option', { name: new RegExp(OTHER_AGENT.name) })
      .click();
    // Nenhuma chamada adicional ao POST.
    expect(assignCalls).toBe(1);
    await expect(selector).toContainText(OTHER_AGENT.name);
  });
});
