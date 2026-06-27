import { describe, expect, it, vi } from 'vitest';
import { CONVERSATIONS_KEY, resyncConversationData } from './realtimeResync';
import { conversationAgentKey, conversationDetailKey, messagesKey } from '../queries';

/**
 * F52-S07 — resync ao (re)conectar. Prova que o handler de `connect` invalida as
 * famílias de query certas: a lista sempre; mensagens/detalhe/agente quando há
 * conversa aberta. Testável com um fake do QueryClient (harness `node`).
 */

function fakeClient() {
  const calls: unknown[][] = [];
  return {
    calls,
    invalidateQueries: vi.fn((f: { queryKey: readonly unknown[] }) => {
      calls.push([...f.queryKey]);
    }),
  };
}

describe('resyncConversationData', () => {
  it('invalida só a lista quando não há conversa aberta', () => {
    const qc = fakeClient();
    resyncConversationData(qc, undefined);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(qc.calls).toEqual([[...CONVERSATIONS_KEY]]);
  });

  it('trata string vazia como ausência de conversa', () => {
    const qc = fakeClient();
    resyncConversationData(qc, '');
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('invalida lista + mensagens + detalhe + agente com conversa aberta', () => {
    const qc = fakeClient();
    resyncConversationData(qc, 'conv-9');
    expect(qc.calls).toEqual([
      [...CONVERSATIONS_KEY],
      [...messagesKey('conv-9')],
      [...conversationDetailKey('conv-9')],
      [...conversationAgentKey('conv-9')],
    ]);
  });
});
