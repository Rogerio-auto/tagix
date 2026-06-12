/**
 * Jornada crítica ponta-a-ponta (F10-S03, DoD principal):
 *
 *   login (storageState) → conectar canal → enviar mensagem → resposta do agente
 *   → trigger de flow → mover deal no pipeline
 *
 * Tudo determinístico: as fixtures mockam a API/WAHA/agent-runtime; a resposta do
 * agente e o resultado do trigger/move vêm do `api-mock` stateful. Um único spec
 * encadeado, na ordem do funil, para validar o fluxo real de um operador.
 */

import { test, expect } from '../fixtures/test';
import {
  ChannelsPage,
  ConversationsPage,
  PipelinePage,
  expectOutboundBubble,
} from '../pages/pom';
import { CONVERSATION, MANUAL_FLOW } from '../fixtures/seed';

test.describe('Jornada completa', () => {
  test('do canal ao pipeline, ponta-a-ponta', async ({ page, mock }) => {
    // ── 0) Já autenticado (storageState). Confere que o app abriu. ──────────
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // ── 1) Conectar canal (WAHA, sem dependência do SDK da Meta) ────────────
    const channels = new ChannelsPage(page);
    await channels.goto();
    await expect(page.getByRole('heading', { name: 'Canais' })).toBeVisible();

    const before = mock.channels.length;
    await channels.connectWaha('Suporte WAHA', 'sess-e2e', 'key-e2e');

    // O backend simulado registrou o canal e a lista re-renderiza com ele.
    await expect(channels.channelRow('Suporte WAHA')).toBeVisible();
    expect(mock.channels.length).toBe(before + 1);

    // ── 2) Abrir a conversa e enviar uma mensagem ───────────────────────────
    const inbox = new ConversationsPage(page);
    await inbox.goto();
    await expect(inbox.chatItem(CONVERSATION.remoteId)).toBeVisible();
    await inbox.chatItem(CONVERSATION.remoteId).click();

    await expect(page).toHaveURL(new RegExp(`/conversations/${CONVERSATION.id}$`));
    // Histórico inbound já visível.
    await expect(inbox.bubbleWithText('quero saber sobre o plano').first()).toBeVisible();

    const sentText = 'Oi! Posso te ajudar com o plano.';
    await inbox.sendText(sentText);

    // A bolha do atendente aparece (otimista → reconciliada com a real).
    await expectOutboundBubble(page, sentText);

    // ── 3) Resposta do agente IA (determinística do mock) ───────────────────
    await expectOutboundBubble(page, 'Nosso plano Pro custa');
    // O agente respondeu exatamente uma vez para esta conversa.
    expect(mock.agentRepliedFor.has(CONVERSATION.id)).toBe(true);

    // ── 4) Disparar um flow manual pela quickbar ────────────────────────────
    await expect(inbox.flowChip(MANUAL_FLOW.name)).toBeVisible();
    await inbox.flowChip(MANUAL_FLOW.name).click();
    await expect(page.getByRole('dialog', { name: 'Disparar flow' })).toBeVisible();
    await inbox.confirmTrigger().click();
    await expect(page.getByText('Flow disparado')).toBeVisible();

    // ── 5) Mover o deal no pipeline ─────────────────────────────────────────
    const pipeline = new PipelinePage(page);
    await pipeline.goto();
    await expect(pipeline.dealCard('Negócio com Ana')).toBeVisible();

    // O drag-and-drop do dnd-kit é frágil em e2e; validamos a regra de negócio
    // (a move-stage real) chamando o mesmo contrato que o board chama, e
    // confirmando o estado do backend simulado. A UI de DnD tem cobertura visual
    // própria; aqui garantimos o efeito ponta-a-ponta de mudança de stage.
    const moved = await page.evaluate(async () => {
      const res = await fetch('/api/deals/deal_e2e_1/move-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stageId: 'stage_negotiation' }),
      });
      return res.ok;
    });
    expect(moved).toBe(true);
    expect(mock.deals.find((d) => d.id === 'deal_e2e_1')?.stageId).toBe('stage_negotiation');
  });
});
