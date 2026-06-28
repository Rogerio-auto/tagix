import { describe, expect, it, beforeEach } from 'vitest';
import { groupByContact, useNotificationsStore } from './store';
import { eventTypeLabel, priorityDotClass } from './labels';
import type { AppNotification } from './types';

function mk(partial: Partial<AppNotification> & { eventId: string }): AppNotification {
  return {
    contactId: null,
    conversationId: null,
    title: 'Lembrete',
    type: 'follow_up',
    priority: 'medium',
    startAt: new Date().toISOString(),
    receivedAt: Date.now(),
    seen: false,
    ...partial,
  };
}

describe('groupByContact', () => {
  it('agrupa notificações do mesmo contato e preserva a ordem de chegada', () => {
    const groups = groupByContact([
      mk({ eventId: 'a', contactId: 'c1' }),
      mk({ eventId: 'b', contactId: 'c2' }),
      mk({ eventId: 'c', contactId: 'c1' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.contactId).toBe('c1');
    expect(groups[0]?.items.map((n) => n.eventId)).toEqual(['a', 'c']);
    expect(groups[1]?.contactId).toBe('c2');
  });

  it('cada evento sem contato vira seu próprio grupo', () => {
    const groups = groupByContact([mk({ eventId: 'x' }), mk({ eventId: 'y' })]);
    expect(groups).toHaveLength(2);
  });
});

describe('store', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: [], lastArrivalAt: null, open: false });
  });

  it('dedup por eventId — não duplica nem reabre o badge', () => {
    const { push } = useNotificationsStore.getState();
    push({
      eventId: 'e1',
      contactId: 'c1',
      conversationId: null,
      title: 'A',
      type: 'call',
      priority: 'high',
      startAt: new Date().toISOString(),
    });
    push({
      eventId: 'e1',
      contactId: 'c1',
      conversationId: null,
      title: 'A (again)',
      type: 'call',
      priority: 'high',
      startAt: new Date().toISOString(),
    });
    expect(useNotificationsStore.getState().notifications).toHaveLength(1);
  });

  it('markAllSeen zera as não-lidas; remove tira da lista', () => {
    const s = useNotificationsStore.getState();
    s.push({
      eventId: 'e2',
      contactId: null,
      conversationId: 'conv1',
      title: 'B',
      type: 'meeting',
      priority: 'low',
      startAt: new Date().toISOString(),
    });
    expect(useNotificationsStore.getState().notifications[0]?.seen).toBe(false);
    useNotificationsStore.getState().markAllSeen();
    expect(useNotificationsStore.getState().notifications[0]?.seen).toBe(true);
    useNotificationsStore.getState().remove('e2');
    expect(useNotificationsStore.getState().notifications).toHaveLength(0);
  });
});

describe('labels', () => {
  it('mapeia tipos conhecidos e cai no fallback', () => {
    expect(eventTypeLabel('follow_up')).toBe('Follow-up');
    expect(eventTypeLabel('desconhecido')).toBe('Compromisso');
  });

  it('cor da prioridade vem de tokens (sem hex)', () => {
    expect(priorityDotClass('high')).toBe('bg-danger');
    expect(priorityDotClass('medium')).toBe('bg-warning');
    expect(priorityDotClass('low')).toBe('bg-info');
  });
});
