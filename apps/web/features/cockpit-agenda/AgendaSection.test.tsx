/**
 * Lógica PURA do card de Agenda do Cockpit (F53-S04): normalização do `EventRow`
 * da API → `AgendaEvent`, partição próximos/histórico e formatação relativa. O
 * vitest do @hm/web roda em ambiente `node` (sem DOM) — testamos as funções puras,
 * não a renderização. Mockamos `next/navigation` (puxado pela cadeia de imports do
 * componente) para o módulo carregar fora do runtime do Next.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
}));

import type { EventRow } from '@/features/calendar/types';
import {
  formatRelativeDay,
  formatWhen,
  isTerminalStatus,
  normalizePriority,
  normalizeStatus,
  normalizeType,
  partitionAgendaEvents,
  priorityLabel,
  statusLabel,
  toAgendaEvent,
  typeLabel,
  type AgendaEvent,
} from './AgendaSection';

/**
 * Monta um `EventRow` plausível. O override é um record solto de propósito: a API
 * (F53-S02) devolve `type`/`status` comerciais e `priority` que o tipo web ainda
 * estreita — testamos justamente a normalização defensiva desses valores.
 */
function makeRow(over: Record<string, unknown>): EventRow {
  const base = {
    id: 'e1',
    workspaceId: 'w1',
    calendarId: 'c1',
    title: 'Compromisso',
    description: null,
    type: 'follow_up',
    startAt: '2026-07-01T12:00:00.000Z',
    endAt: '2026-07-01T12:30:00.000Z',
    status: 'scheduled',
    priority: 'medium',
    location: null,
    meetingUrl: null,
    contactId: 'ct1',
    dealId: null,
    conversationId: 'cv1',
    createdBy: null,
    createdByAgentId: null,
    recurrenceRule: null,
    recurrenceUntil: null,
    recurrenceParentId: null,
    metadata: {},
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: null,
  };
  return { ...base, ...over } as unknown as EventRow;
}

describe('normalizadores de vocabulário (espelham events_*_chk)', () => {
  it('mantém status válido e cai em scheduled para desconhecido', () => {
    expect(normalizeStatus('in_progress')).toBe('in_progress');
    expect(normalizeStatus('postponed')).toBe('postponed');
    expect(normalizeStatus('bogus')).toBe('scheduled');
  });

  it('mantém type comercial e cai em other para desconhecido', () => {
    expect(normalizeType('call')).toBe('call');
    expect(normalizeType('proposal')).toBe('proposal');
    expect(normalizeType('???')).toBe('other');
  });

  it('valida priority e default medium', () => {
    expect(normalizePriority('high')).toBe('high');
    expect(normalizePriority('low')).toBe('low');
    expect(normalizePriority(undefined)).toBe('medium');
    expect(normalizePriority('urgent')).toBe('medium');
  });

  it('classifica estados terminais', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('scheduled')).toBe(false);
    expect(isTerminalStatus('in_progress')).toBe(false);
  });
});

describe('toAgendaEvent', () => {
  it('mapeia campos e lê a priority não declarada no tipo web', () => {
    const evt = toAgendaEvent(
      makeRow({ id: 'abc', status: 'confirmed', type: 'call', priority: 'high' }),
    );
    expect(evt.id).toBe('abc');
    expect(evt.masterId).toBe('abc');
    expect(evt.status).toBe('confirmed');
    expect(evt.type).toBe('call');
    expect(evt.priority).toBe('high');
    expect(evt.startMs).toBe(new Date('2026-07-01T12:00:00.000Z').getTime());
  });

  it('resolve o id mestre de uma ocorrência sintética', () => {
    const evt = toAgendaEvent(makeRow({ id: 'evt:master-9:2026-07-01T12:00:00.000Z' }));
    expect(evt.masterId).toBe('master-9');
  });

  it('prefere recurrenceParentId quando presente', () => {
    const evt = toAgendaEvent(
      makeRow({ id: 'evt:x:iso', recurrenceParentId: 'real-parent' }),
    );
    expect(evt.masterId).toBe('real-parent');
  });
});

describe('partitionAgendaEvents', () => {
  const mk = (id: string, status: AgendaEvent['status'], startMs: number): AgendaEvent => ({
    id,
    masterId: id,
    title: id,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + 1).toISOString(),
    status,
    type: 'follow_up',
    priority: 'medium',
    description: null,
    conversationId: null,
    startMs,
  });

  it('separa terminal (histórico) de não-terminal (próximos)', () => {
    const { upcoming, history } = partitionAgendaEvents([
      mk('a', 'scheduled', 300),
      mk('b', 'completed', 100),
      mk('c', 'cancelled', 200),
      mk('d', 'in_progress', 50),
    ]);
    expect(upcoming.map((e) => e.id)).toEqual(['d', 'a']); // crescente por startMs
    expect(history.map((e) => e.id)).toEqual(['c', 'b']); // decrescente por startMs
  });

  it('devolve listas vazias sem entrada', () => {
    const { upcoming, history } = partitionAgendaEvents([]);
    expect(upcoming).toEqual([]);
    expect(history).toEqual([]);
  });
});

describe('formatação relativa', () => {
  const now = new Date('2026-07-01T10:00:00.000Z');

  it('rotula hoje / amanhã / ontem', () => {
    expect(formatRelativeDay(new Date('2026-07-01T18:00:00.000Z'), now)).toBe('Hoje');
    expect(formatRelativeDay(new Date('2026-07-02T09:00:00.000Z'), now)).toBe('Amanhã');
    expect(formatRelativeDay(new Date('2026-06-30T09:00:00.000Z'), now)).toBe('Ontem');
  });

  it('formatWhen combina dia relativo e horário', () => {
    const when = formatWhen('2026-07-02T09:00:00.000Z', now);
    expect(when.startsWith('Amanhã • ')).toBe(true);
  });

  it('formatWhen é vazio para data inválida', () => {
    expect(formatWhen('not-a-date', now)).toBe('');
  });
});

describe('rótulos PT-BR', () => {
  it('cobre status, prioridade e tipo', () => {
    expect(statusLabel('postponed')).toBe('Adiado');
    expect(priorityLabel('high')).toBe('Alta');
    expect(typeLabel('whatsapp')).toBe('WhatsApp');
  });
});
