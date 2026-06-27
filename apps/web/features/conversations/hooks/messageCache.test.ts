import { describe, expect, it } from 'vitest';
import { dedupeMessages, markMediaFailed, type MessagesPage } from './messageCache';
import type { MessageItem } from '../types';

/**
 * F52-S07 — operações puras sobre o cache de mensagens: dedup defensivo (socket +
 * refetch nunca duplica bolha) e patch de falha de mídia (sem refetch).
 */

function msg(id: string, over: Partial<MessageItem> = {}): MessageItem {
  return {
    id,
    conversationId: 'conv-1',
    direction: 'inbound',
    senderType: 'contact',
    type: 'text',
    content: 'oi',
    viewStatus: 'sent',
    mediaUrl: null,
    createdAt: '2026-06-27T10:00:00.000Z',
    ...over,
  };
}

describe('dedupeMessages', () => {
  it('remove ids duplicados preservando a primeira ocorrência e a ordem', () => {
    const out = dedupeMessages([msg('a'), msg('b'), msg('a'), msg('c')]);
    expect(out.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('é no-op quando não há duplicatas', () => {
    const input = [msg('a'), msg('b')];
    expect(dedupeMessages(input).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('mantém a primeira bolha de um id repetido (DESC = mais recente)', () => {
    const first = msg('a', { content: 'real' });
    const dup = msg('a', { content: 'stale' });
    const [kept] = dedupeMessages([first, dup]);
    expect(kept?.content).toBe('real');
  });
});

describe('markMediaFailed', () => {
  it('marca a mensagem-alvo como mediaFailed', () => {
    const page: MessagesPage = { messages: [msg('a'), msg('b', { type: 'image' })] };
    const next = markMediaFailed(page, 'b');
    expect(next?.messages.find((m) => m.id === 'b')?.mediaFailed).toBe(true);
    expect(next?.messages.find((m) => m.id === 'a')?.mediaFailed).toBeUndefined();
  });

  it('retorna a MESMA referência quando a mensagem não existe (evita re-render)', () => {
    const page: MessagesPage = { messages: [msg('a')] };
    expect(markMediaFailed(page, 'nope')).toBe(page);
  });

  it('retorna a MESMA referência quando já está marcada', () => {
    const page: MessagesPage = { messages: [msg('a', { mediaFailed: true })] };
    expect(markMediaFailed(page, 'a')).toBe(page);
  });

  it('é seguro com cache indefinido', () => {
    expect(markMediaFailed(undefined, 'a')).toBeUndefined();
  });
});
