import { describe, expect, it } from 'vitest';
import {
  buildAgendaList,
  dayRelative,
  groupAgendaByDay,
  isOverdue,
  isTerminalStatus,
  selectAgendaEvents,
  startOfDayMs,
} from './agendaList';
import type { EventRow, EventStatus } from './types';

/**
 * F54-S03 — agrupamento/ordenação/vencido PUROS. Usamos um `now` fixo em horário
 * LOCAL e derivamos os esperados das mesmas APIs locais de Date, para não depender
 * do fuso da máquina de CI.
 */

/** Constrói um `EventRow` mínimo. `start`/`end` em ms locais. */
function evt(
  id: string,
  startMs: number,
  status: EventStatus | 'in_progress' | 'postponed' = 'scheduled',
  durationMin = 30,
): EventRow {
  const start = new Date(startMs);
  const end = new Date(startMs + durationMin * 60_000);
  return {
    id,
    workspaceId: 'ws',
    calendarId: 'cal',
    title: `Evento ${id}`,
    description: null,
    type: 'follow_up',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    status: status as EventStatus,
    location: null,
    meetingUrl: null,
    contactId: null,
    dealId: null,
    conversationId: null,
    createdBy: null,
    createdByAgentId: null,
    recurrenceRule: null,
    recurrenceUntil: null,
    recurrenceParentId: null,
    metadata: {},
    createdAt: start.toISOString(),
    updatedAt: null,
  };
}

const NOW = new Date(2026, 5, 28, 14, 0, 0).getTime(); // 28/jun/2026 14:00 local
const at = (dayOffset: number, hour: number): number => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

describe('isTerminalStatus', () => {
  it('completed e cancelled são terminais; os demais não', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('scheduled')).toBe(false);
    expect(isTerminalStatus('in_progress')).toBe(false);
    expect(isTerminalStatus('postponed')).toBe(false);
  });
});

describe('dayRelative', () => {
  it('classifica passado/ontem/hoje/amanhã/futuro', () => {
    expect(dayRelative(startOfDayMs(at(-3, 0)), NOW)).toBe('past');
    expect(dayRelative(startOfDayMs(at(-1, 0)), NOW)).toBe('yesterday');
    expect(dayRelative(startOfDayMs(at(0, 0)), NOW)).toBe('today');
    expect(dayRelative(startOfDayMs(at(1, 0)), NOW)).toBe('tomorrow');
    expect(dayRelative(startOfDayMs(at(5, 0)), NOW)).toBe('future');
  });
});

describe('isOverdue', () => {
  it('não-terminal antes de agora → vencido', () => {
    expect(isOverdue(evt('a', at(0, 9)), NOW)).toBe(true); // hoje 09h, agora 14h
    expect(isOverdue(evt('b', at(-1, 10)), NOW)).toBe(true); // ontem
  });
  it('não-terminal no futuro → não vencido', () => {
    expect(isOverdue(evt('c', at(0, 18)), NOW)).toBe(false); // hoje 18h
    expect(isOverdue(evt('d', at(2, 9)), NOW)).toBe(false);
  });
  it('terminal nunca é vencido, mesmo no passado', () => {
    expect(isOverdue(evt('e', at(-1, 9), 'completed'), NOW)).toBe(false);
    expect(isOverdue(evt('f', at(-1, 9), 'cancelled'), NOW)).toBe(false);
  });
});

describe('selectAgendaEvents', () => {
  it('descarta cancelados sempre', () => {
    const out = selectAgendaEvents([evt('a', at(0, 16), 'cancelled'), evt('b', at(0, 16))], NOW);
    expect(out.map((e) => e.id)).toEqual(['b']);
  });
  it('em dias passados mantém só não-terminais (vencidos)', () => {
    const out = selectAgendaEvents(
      [evt('done', at(-1, 9), 'completed'), evt('open', at(-1, 9), 'scheduled')],
      NOW,
    );
    expect(out.map((e) => e.id)).toEqual(['open']);
  });
  it('hoje/futuro mantêm concluídos (não-cancelados)', () => {
    const out = selectAgendaEvents(
      [evt('todayDone', at(0, 9), 'completed'), evt('future', at(2, 9))],
      NOW,
    );
    expect(out.map((e) => e.id).sort()).toEqual(['future', 'todayDone']);
  });
  it('ignora datas inválidas', () => {
    const broken = { ...evt('x', at(0, 9)), startAt: 'lixo' };
    expect(selectAgendaEvents([broken], NOW)).toEqual([]);
  });
});

describe('groupAgendaByDay', () => {
  it('agrupa por dia e ordena grupos do passado ao futuro', () => {
    const groups = groupAgendaByDay(
      [evt('today', at(0, 9)), evt('past', at(-2, 9)), evt('future', at(3, 9))],
      NOW,
    );
    expect(groups.map((g) => g.relative)).toEqual(['past', 'today', 'future']);
  });

  it('ordena itens do mesmo dia por horário crescente', () => {
    const groups = groupAgendaByDay(
      [evt('late', at(0, 16)), evt('early', at(0, 9)), evt('mid', at(0, 11))],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((i) => i.event.id)).toEqual(['early', 'mid', 'late']);
  });

  it('marca o grupo como overdue quando há ao menos um item vencido', () => {
    const groups = groupAgendaByDay([evt('a', at(0, 9)), evt('b', at(0, 18))], NOW);
    expect(groups[0]?.overdue).toBe(true);
    expect(groups[0]?.items.find((i) => i.event.id === 'a')?.overdue).toBe(true);
    expect(groups[0]?.items.find((i) => i.event.id === 'b')?.overdue).toBe(false);
  });

  it('desempata horários iguais por id (estável)', () => {
    const groups = groupAgendaByDay([evt('z', at(1, 9)), evt('a', at(1, 9))], NOW);
    expect(groups[0]?.items.map((i) => i.event.id)).toEqual(['a', 'z']);
  });
});

describe('buildAgendaList', () => {
  it('compõe seleção + agrupamento: descarta histórico passado, mantém vencidos e futuros', () => {
    const groups = buildAgendaList(
      [
        evt('pastDone', at(-2, 9), 'completed'),
        evt('pastOpen', at(-2, 9), 'scheduled'),
        evt('todayLate', at(0, 16)),
        evt('cancelled', at(1, 9), 'cancelled'),
        evt('tomorrow', at(1, 10)),
      ],
      NOW,
    );
    expect(groups.map((g) => g.relative)).toEqual(['past', 'today', 'tomorrow']);
    const ids = groups.flatMap((g) => g.items.map((i) => i.event.id));
    expect(ids).toEqual(['pastOpen', 'todayLate', 'tomorrow']);
    expect(groups[0]?.overdue).toBe(true);
  });

  it('lista vazia → sem grupos', () => {
    expect(buildAgendaList([], NOW)).toEqual([]);
  });
});
