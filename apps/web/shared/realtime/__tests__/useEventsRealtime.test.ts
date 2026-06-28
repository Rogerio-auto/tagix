import { describe, expect, it, vi } from 'vitest';
import type { EventChangedPayload } from '@hm/shared';
import {
  EVENTS_LIST_KEY,
  eventDetailKey,
  invalidateForEventChange,
} from '../useEventsRealtime';

/**
 * F54-S02 — ouvinte de compromissos em tempo real. Prova a lógica pura de
 * invalidação: a lista (`['events']`) invalida em toda mudança; o detalhe
 * (`['event', id]`) só em `updated`/`deleted`. Testável com um fake do
 * QueryClient (harness `node`, sem DOM).
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

function payload(kind: EventChangedPayload['kind']): EventChangedPayload {
  return {
    eventId: 'evt-42',
    workspaceId: 'ws-1',
    contactId: null,
    conversationId: null,
    kind,
  };
}

describe('invalidateForEventChange', () => {
  it('created: invalida só a lista', () => {
    const qc = fakeClient();
    invalidateForEventChange(qc, payload('created'));
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(qc.calls).toEqual([[...EVENTS_LIST_KEY]]);
  });

  it('updated: invalida lista + detalhe do evento', () => {
    const qc = fakeClient();
    invalidateForEventChange(qc, payload('updated'));
    expect(qc.calls).toEqual([[...EVENTS_LIST_KEY], [...eventDetailKey('evt-42')]]);
  });

  it('deleted: invalida lista + detalhe do evento', () => {
    const qc = fakeClient();
    invalidateForEventChange(qc, payload('deleted'));
    expect(qc.calls).toEqual([[...EVENTS_LIST_KEY], [...eventDetailKey('evt-42')]]);
  });

  it('eventDetailKey escopa pelo id recebido', () => {
    expect(eventDetailKey('evt-99')).toEqual(['event', 'evt-99']);
  });
});
