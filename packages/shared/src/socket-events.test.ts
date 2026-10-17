/**
 * F61-S13 — o contrato do `message:new` e a regra do aviso, testados JUNTOS.
 *
 * O que este arquivo protege: o defeito que deixou o aviso de lead novo sem
 * disparar. A regra exigia `senderType === 'contact'`; os emissores não mandavam o
 * campo; e o teste da F61-S04 montava o payload à mão, com o campo. Aqui a regra
 * só é testada contra a saída do construtor que os emissores usam de verdade.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMessageNewPayload,
  newMessageNotificationTarget,
  SERVER_TO_CLIENT_EVENTS,
  type MessageNewMessage,
  type ServerToClientPayload,
} from './socket-events';

const base: MessageNewMessage = {
  id: 'm1',
  conversationId: 'c1',
  externalId: 'wamid.1',
  type: 'text',
  content: 'quanto fica a reforma?',
  direction: 'inbound',
  senderType: 'contact',
  origin: 'live',
};

const montar = (over: Partial<MessageNewMessage> = {}) =>
  buildMessageNewPayload({ workspaceId: 'w1', message: { ...base, ...over } });

describe('newMessageNotificationTarget — sobre a saída real do construtor', () => {
  it('mensagem ao vivo de contato avisa', () => {
    expect(newMessageNotificationTarget(montar())).toEqual({ conversationId: 'c1', messageId: 'm1' });
  });

  it('resposta do atendente, de agente e de sistema não avisam', () => {
    for (const senderType of ['member', 'agent', 'system'] as const) {
      expect(newMessageNotificationTarget(montar({ senderType, direction: 'outbound' }))).toBeNull();
    }
  });

  it('remetente declarado desconhecido (outbound) não avisa', () => {
    expect(newMessageNotificationTarget(montar({ senderType: null, direction: 'outbound' }))).toBeNull();
  });

  it('sincronização da coexistência não avisa, nem quando a mensagem é do contato', () => {
    // Sincronizar histórico não pode tocar o celular uma vez por mensagem antiga.
    expect(newMessageNotificationTarget(montar({ origin: 'coexistence' }))).toBeNull();
  });

  it('payload de versão antiga do worker, sem senderType, não avisa e não lança', () => {
    const antigo = { workspaceId: 'w1', conversationId: 'c1', message: { id: 'm1', direction: 'inbound' } };
    expect(newMessageNotificationTarget(antigo)).toBeNull();
  });

  it('lixo não lança', () => {
    for (const lixo of [null, undefined, 'x', 1, {}, { message: null }]) {
      expect(newMessageNotificationTarget(lixo)).toBeNull();
    }
  });
});

describe('buildMessageNewPayload', () => {
  it('a conversa do envelope é a da mensagem — não há como divergir', () => {
    const p = montar({ conversationId: 'c9' });
    expect(p.conversationId).toBe('c9');
    expect(p.message.conversationId).toBe('c9');
  });

  it('não compartilha referência com a entrada', () => {
    const msg = { ...base };
    const p = buildMessageNewPayload({ workspaceId: 'w1', message: msg });
    expect(p.message).not.toBe(msg);
  });
});

describe('eventos do Copiloto (F73-S02 — COPILOTO.md §5.5)', () => {
  it('os três eventos estão na lista de runtime que o relay valida', () => {
    for (const e of ['copilot:proposal_updated', 'copilot:briefing_ready', 'copilot:suggestions_changed'] as const) {
      expect(SERVER_TO_CLIENT_EVENTS).toContain(e);
    }
  });

  it('a lista de runtime não tem nome repetido', () => {
    expect(new Set(SERVER_TO_CLIENT_EVENTS).size).toBe(SERVER_TO_CLIENT_EVENTS.length);
  });

  it('payloads tipados em snake_case, sem PII', () => {
    const progresso: ServerToClientPayload<'copilot:proposal_updated'> = {
      proposal_id: 'p1',
      status: 'executing',
      progress: { done: 5, total: 7, failed: 0 },
      version: 2,
    };
    const briefing: ServerToClientPayload<'copilot:briefing_ready'> = { for_date: '2026-10-16', item_count: 3 };
    const sugestoes: ServerToClientPayload<'copilot:suggestions_changed'> = { pending_count: 4 };
    expect(Object.keys(progresso).sort()).toEqual(['progress', 'proposal_id', 'status', 'version']);
    expect(Object.keys(briefing).sort()).toEqual(['for_date', 'item_count']);
    // Sala do workspace inteiro: só a contagem pode viajar.
    expect(Object.keys(sugestoes)).toEqual(['pending_count']);
  });
});
