import { describe, expect, it } from 'vitest';
import {
  buildAgendaList,
  dayRelative,
  groupAgendaByDay,
  isOverdue,
  selectAgendaEvents,
  startOfDayMs,
} from '../agendaList';
import type { EventContactSummary, EventRow, EventStatus } from '../types';

/**
 * F54-S05 — edge cases adversariais da lógica PURA da Agenda (lista por dia).
 * Reforça limites que o `agendaList.test.ts` não cobre: fronteira de meia-noite,
 * `start === now`, virada de semana/mês, status não-terminais estendidos
 * (in_progress/postponed), contato nulo/presente, e rajada de itens no mesmo dia.
 *
 * `now` em horário LOCAL e esperados derivados das mesmas APIs de Date — independente
 * do fuso da máquina de CI.
 */

function evt(
  id: string,
  startMs: number,
  status: EventStatus | 'in_progress' | 'postponed' = 'scheduled',
  contact: EventContactSummary | null = null,
): EventRow {
  const start = new Date(startMs);
  const end = new Date(startMs + 30 * 60_000);
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
    contactId: contact?.id ?? null,
    dealId: null,
    conversationId: null,
    createdBy: null,
    createdByAgentId: null,
    recurrenceRule: null,
    recurrenceUntil: null,
    recurrenceParentId: null,
    contact,
    metadata: {},
    createdAt: start.toISOString(),
    updatedAt: null,
  };
}

// Quarta-feira, 28/jun/2026 14:00 local.
const NOW = new Date(2026, 5, 28, 14, 0, 0).getTime();
const atHM = (dayOffset: number, hour: number, min = 0): number => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, min, 0, 0);
  return d.getTime();
};

describe('fronteira exata de "agora"', () => {
  it('start === now NÃO é vencido (limite estrito start < now)', () => {
    expect(isOverdue(evt('exact', NOW), NOW)).toBe(false);
  });
  it('1ms antes de agora JÁ é vencido', () => {
    expect(isOverdue(evt('just', NOW - 1), NOW)).toBe(true);
  });
});

describe('fronteira de meia-noite (virada de dia)', () => {
  it('23:59 de ontem e 00:00 de hoje caem em grupos distintos e ordenados', () => {
    const lateYesterday = atHM(-1, 23, 59);
    const earlyToday = atHM(0, 0, 0);
    const groups = groupAgendaByDay([evt('today0', earlyToday), evt('yest', lateYesterday)], NOW);
    expect(groups.map((g) => g.relative)).toEqual(['yesterday', 'today']);
    expect(groups[0]?.items.map((i) => i.event.id)).toEqual(['yest']);
    expect(groups[1]?.items.map((i) => i.event.id)).toEqual(['today0']);
  });

  it('00:00 de hoje é classificado como today (não yesterday)', () => {
    expect(dayRelative(startOfDayMs(atHM(0, 0, 0)), NOW)).toBe('today');
  });

  it('evento à meia-noite de hoje, com agora 14h → vencido (passou às 00:00)', () => {
    expect(isOverdue(evt('mid', atHM(0, 0, 0)), NOW)).toBe(true);
  });
});

describe('virada de semana e de mês', () => {
  it('agrupa dias através da virada de mês mantendo ordem cronológica', () => {
    // 28/jun (hoje) → 30/jun → 01/jul → 03/jul: dias distintos, ascendentes.
    const groups = groupAgendaByDay(
      [evt('jul3', atHM(5, 9)), evt('jun30', atHM(2, 9)), evt('jul1', atHM(3, 9)), evt('jun28', atHM(0, 9))],
      NOW,
    );
    const days = groups.map((g) => new Date(g.dayMs).getDate());
    expect(days).toEqual([28, 30, 1, 3]);
    // monotonicamente crescente em ms apesar da virada de mês.
    const ms = groups.map((g) => g.dayMs);
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
  });

  it('virada de semana (sáb→dom) não funde dias diferentes', () => {
    // 28/jun/2026 é domingo? new Date(2026,5,28).getDay(): calcular relativo é suficiente.
    const groups = groupAgendaByDay([evt('a', atHM(6, 9)), evt('b', atHM(7, 9))], NOW);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.dayMs).toBeLessThan(groups[1]!.dayMs);
  });
});

describe('status não-terminais estendidos (in_progress / postponed)', () => {
  it('in_progress no passado é vencido e sobrevive à seleção', () => {
    expect(isOverdue(evt('ip', atHM(-1, 9), 'in_progress'), NOW)).toBe(true);
    const out = selectAgendaEvents([evt('ip', atHM(-1, 9), 'in_progress')], NOW);
    expect(out.map((e) => e.id)).toEqual(['ip']);
  });
  it('postponed no passado é vencido (não-terminal)', () => {
    expect(isOverdue(evt('pp', atHM(-2, 9), 'postponed'), NOW)).toBe(true);
    const out = selectAgendaEvents([evt('pp', atHM(-2, 9), 'postponed')], NOW);
    expect(out.map((e) => e.id)).toEqual(['pp']);
  });
});

describe('contato no item (presente / nulo)', () => {
  it('preserva o resumo do contato no item agrupado', () => {
    const c: EventContactSummary = {
      id: 'c1',
      name: 'Maria',
      avatarUrl: null,
      phone: '+5511999999999',
    };
    const groups = buildAgendaList([evt('x', atHM(0, 16), 'scheduled', c)], NOW);
    expect(groups[0]?.items[0]?.event.contact).toEqual(c);
  });
  it('contato nulo não quebra o agrupamento', () => {
    const groups = buildAgendaList([evt('x', atHM(0, 16), 'scheduled', null)], NOW);
    expect(groups[0]?.items[0]?.event.contact).toBeNull();
  });
});

describe('rajada de itens no mesmo dia (ordenação estável)', () => {
  it('100 eventos no mesmo dia ficam ordenados por horário e id (estável)', () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      // horas repetidas de propósito para forçar o desempate por id.
      evt(`e${String(i).padStart(3, '0')}`, atHM(1, 8 + (i % 6))),
    );
    const groups = groupAgendaByDay(items, NOW);
    expect(groups).toHaveLength(1);
    const ordered = groups[0]!.items;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1]!;
      const cur = ordered[i]!;
      const inOrder =
        prev.startMs < cur.startMs ||
        (prev.startMs === cur.startMs && prev.event.id.localeCompare(cur.event.id) <= 0);
      expect(inOrder).toBe(true);
    }
  });
});

describe('robustez de seleção', () => {
  it('lista 100% cancelada → sem grupos', () => {
    const all = [evt('a', atHM(0, 9), 'cancelled'), evt('b', atHM(1, 9), 'cancelled')];
    expect(buildAgendaList(all, NOW)).toEqual([]);
  });
  it('endAt inválido não afeta (a seleção usa startAt) — startAt inválido é descartado', () => {
    const bad = { ...evt('bad', atHM(0, 9)), startAt: 'not-a-date' };
    const good = evt('good', atHM(0, 9));
    expect(buildAgendaList([bad, good], NOW).flatMap((g) => g.items.map((i) => i.event.id))).toEqual([
      'good',
    ]);
  });
});
