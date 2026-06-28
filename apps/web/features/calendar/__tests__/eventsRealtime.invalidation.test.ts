import { describe, expect, it, vi } from 'vitest';
import type { EventChangedPayload } from '@hm/shared';
import {
  EVENTS_LIST_KEY,
  eventDetailKey,
  invalidateForEventChange,
} from '@/shared/realtime/useEventsRealtime';

/**
 * F54-S05 (adversarial) — confiabilidade da invalidação sob rajada e duplicata.
 *
 * A lógica de invalidação é a fronteira de sincronização Cockpit↔Agenda: cada
 * `event:*` que chega tem de invalidar a lista (e o detalhe quando aplicável). Como
 * o cache TanStack é global, invalidar de um ponto sincroniza ambas as telas.
 *
 * Estes testes complementam `shared/realtime/__tests__/useEventsRealtime.test.ts`
 * (casos unitários por kind) caminhando nos limites: rajada de N eventos, duplicata
 * idempotente e ausência de invalidação de detalhe no `created`.
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

function payload(kind: EventChangedPayload['kind'], eventId = 'evt-1'): EventChangedPayload {
  return { eventId, workspaceId: 'ws-1', contactId: null, conversationId: null, kind };
}

describe('rajada de eventos', () => {
  it('processa N eventos misturados, invalidando a lista em TODOS eles', () => {
    const qc = fakeClient();
    const burst: EventChangedPayload['kind'][] = [
      'created',
      'updated',
      'created',
      'deleted',
      'updated',
    ];
    for (const k of burst) invalidateForEventChange(qc, payload(k));
    // 5 listas + 3 detalhes (updated, deleted, updated) = 8 chamadas.
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(8);
    const listCalls = qc.calls.filter((c) => c[0] === EVENTS_LIST_KEY[0] && c.length === 1);
    expect(listCalls).toHaveLength(5);
  });

  it('rajada de 50 created → 50 invalidações de lista, zero de detalhe', () => {
    const qc = fakeClient();
    for (let i = 0; i < 50; i++) invalidateForEventChange(qc, payload('created', `evt-${i}`));
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(50);
    expect(qc.calls.every((c) => c.length === 1 && c[0] === 'events')).toBe(true);
  });
});

describe('duplicata de emit (idempotência)', () => {
  it('o MESMO updated entregue 2x produz invalidações idênticas (refetch é idempotente)', () => {
    const qc = fakeClient();
    invalidateForEventChange(qc, payload('updated', 'dup'));
    const afterFirst = [...qc.calls];
    invalidateForEventChange(qc, payload('updated', 'dup'));
    const secondHalf = qc.calls.slice(afterFirst.length);
    // Mesmas chaves nas duas entregas — invalidar de novo só dispara refetch (seguro).
    expect(secondHalf).toEqual(afterFirst);
    expect(secondHalf).toEqual([[...EVENTS_LIST_KEY], [...eventDetailKey('dup')]]);
  });
});

describe('detalhe escopado por id', () => {
  it('updated/deleted invalidam o detalhe do id exato (não outros)', () => {
    const qc = fakeClient();
    invalidateForEventChange(qc, payload('updated', 'evt-A'));
    invalidateForEventChange(qc, payload('deleted', 'evt-B'));
    expect(qc.calls).toContainEqual([...eventDetailKey('evt-A')]);
    expect(qc.calls).toContainEqual([...eventDetailKey('evt-B')]);
    expect(qc.calls).not.toContainEqual([...eventDetailKey('evt-A'), 'x']);
  });
});
