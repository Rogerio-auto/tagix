/**
 * F72-S04 — modelo da Home, puro (sem banco): roda em qualquer ambiente.
 *
 * Protege o DoD do slot que não depende de infra:
 *  - quem vê o quê: AGENT/READONLY nunca recebem custo nem métrica de dono, MESMO que
 *    os agregados da empresa cheguem à projeção por engano;
 *  - "o que mudou": janela anterior do mesmo tamanho, contígua, e `previous` honesto
 *    (sem base vira `null`, não zero);
 *  - "precisa da sua atenção": cada item com rota e alvo da ação, crítico primeiro.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from '@hm/shared';
import {
  buildHomePayload,
  canSeeChannelHealth,
  fillRevenueSeries,
  HOME_DEFAULT_SLA_MINUTES,
  HOME_PERIOD_DAYS,
  homeScopeForRole,
  homeWindows,
  resolveSlaMinutes,
  toFiniteNumber,
  type AttentionAggregates,
  type BuildHomeInput,
  type PersonalAggregates,
  type WorkspaceAggregates,
} from './home-model';

const AGORA = new Date('2026-09-15T18:00:00Z');
const DIA = 86_400_000;
const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY'];

/** Valores "marcados": se aparecerem no payload de um AGENT, houve vazamento. */
const RECEITA_EMPRESA = 987_654_321;
const RECEITA_ANTERIOR = 123_456_789;
const LEADS_EMPRESA = 4_242;

const WORKSPACE: WorkspaceAggregates = {
  hasConversionTypes: true,
  revenueCents: { current: RECEITA_EMPRESA, previous: RECEITA_ANTERIOR },
  conversions: { current: 31, previous: 17 },
  leads: { current: LEADS_EMPRESA, previous: 3_100 },
  speedToLead: {
    current: { medianSeconds: 60, answered: 3, unanswered: 1 },
    previous: { medianSeconds: 120, answered: 1, unanswered: 0 },
  },
  journey: { leads: LEADS_EMPRESA, conversations: 900, booked: 120, won: 31 },
  revenueSeries: [{ day: '2026-09-15', valueCents: RECEITA_EMPRESA }],
};

const PERSONAL: PersonalAggregates = {
  open: 5,
  waiting: 2,
  resolvedToday: 3,
  speedToLead: {
    current: { medianSeconds: 45, answered: 2, unanswered: 0 },
    previous: { medianSeconds: null, answered: 0, unanswered: 0 },
  },
};

const ATTENTION: AttentionAggregates = {
  waiting: {
    count: 1,
    oldestAt: new Date(AGORA.getTime() - 90 * 60_000),
    oldestConversationId: 'conv-1',
  },
  stalledDeals: { count: 4, oldestDealId: 'deal-9' },
  channelDown: { count: 1, onlyChannelId: 'chan-1', metaLoginExpired: false },
  mediaFailed: { count: 2, latestConversationId: 'conv-7' },
};

/** Entrada "vazada": os dois escopos carregados, saúde de canal incluída. */
function input(role: Role, over: Partial<BuildHomeInput> = {}): BuildHomeInput {
  return {
    role,
    now: AGORA,
    periodDays: HOME_PERIOD_DAYS,
    sla: { minutes: HOME_DEFAULT_SLA_MINUTES, source: 'default' },
    workspace: WORKSPACE,
    personal: PERSONAL,
    attention: ATTENTION,
    ...over,
  };
}

const OWNER_KEYS = ['revenue', 'leads', 'speed_to_lead', 'conversions'];
const PERSONAL_KEYS = ['waiting_mine', 'open_mine', 'resolved_mine', 'speed_to_lead'];
const COST_TERMS = ['cost', 'custo', 'usd', 'llm', 'token', 'roi', 'cap_mensal', 'billing'];

describe('homeScopeForRole', () => {
  it('só SUPERVISOR, ADMIN e OWNER recebem o resultado da empresa', () => {
    expect(ROLES.filter((r) => homeScopeForRole(r) === 'workspace')).toEqual([
      'OWNER',
      'ADMIN',
      'SUPERVISOR',
    ]);
  });

  it('AGENT e READONLY ficam no escopo pessoal', () => {
    expect(homeScopeForRole('AGENT')).toBe('personal');
    expect(homeScopeForRole('READONLY')).toBe('personal');
  });

  it('saúde de canal só para quem pode reconectar (channel.connect)', () => {
    expect(ROLES.filter(canSeeChannelHealth)).toEqual(['OWNER', 'ADMIN']);
  });
});

describe('buildHomePayload — recorte por papel (servidor)', () => {
  for (const role of ['AGENT', 'READONLY'] as const) {
    it(`${role} não recebe métrica de dono nem custo, mesmo com agregados da empresa`, () => {
      const r = buildHomePayload(input(role));
      expect(r.scope).toBe('personal');
      expect(r.kpis.map((k) => k.key)).toEqual(PERSONAL_KEYS);
      expect(r.kpis.some((k) => k.unit === 'cents')).toBe(false);
      expect(r.journey).toBeNull();
      expect(r.revenueSeries).toBeNull();
      expect(r.attention.map((a) => a.kind)).not.toContain('channel_down');

      const raw = JSON.stringify(r);
      for (const n of [RECEITA_EMPRESA, RECEITA_ANTERIOR, LEADS_EMPRESA]) {
        expect(raw, `${role} recebeu número da empresa ${n}`).not.toContain(String(n));
      }
      for (const key of OWNER_KEYS.filter((k) => k !== 'speed_to_lead')) {
        expect(raw, `${role} recebeu ${key}`).not.toContain(`"${key}"`);
      }
    });
  }

  it('OWNER e ADMIN recebem o resultado da empresa, com período anterior e canal caído', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const r = buildHomePayload(input(role));
      expect(r.scope).toBe('workspace');
      expect(r.kpis.map((k) => k.key)).toEqual(OWNER_KEYS);
      expect(r.kpis.find((k) => k.key === 'revenue')).toMatchObject({
        unit: 'cents',
        value: RECEITA_EMPRESA,
        previous: RECEITA_ANTERIOR,
        betterWhen: 'higher',
      });
      expect(r.kpis.find((k) => k.key === 'leads')).toMatchObject({
        value: LEADS_EMPRESA,
        previous: 3_100,
      });
      expect(r.kpis.find((k) => k.key === 'conversions')).toMatchObject({
        value: 31,
        previous: 17,
      });
      expect(r.journey).toEqual(WORKSPACE.journey);
      expect(r.revenueSeries).toHaveLength(1);
      expect(r.attention.map((a) => a.kind)).toContain('channel_down');
    }
  });

  it('SUPERVISOR vê o resultado da empresa, mas não a saúde de canal (não reconecta)', () => {
    const r = buildHomePayload(input('SUPERVISOR'));
    expect(r.scope).toBe('workspace');
    expect(r.attention.map((a) => a.kind)).not.toContain('channel_down');
  });

  it('nenhum papel recebe custo de IA/infra (o contrato não tem esse campo)', () => {
    for (const role of ROLES) {
      const raw = JSON.stringify(buildHomePayload(input(role))).toLowerCase();
      for (const term of COST_TERMS) {
        expect(raw, `${role} recebeu "${term}"`).not.toContain(term);
      }
    }
  });

  it('falha alto se o escopo do papel não tem os agregados que exige', () => {
    expect(() => buildHomePayload(input('OWNER', { workspace: null }))).toThrow(/workspace/);
    expect(() => buildHomePayload(input('AGENT', { personal: null }))).toThrow(/pessoal/);
  });
});

describe('buildHomePayload — "o que mudou"', () => {
  it('speed-to-lead traz a mediana atual, a anterior e a amostra', () => {
    const r = buildHomePayload(input('OWNER'));
    expect(r.kpis.find((k) => k.key === 'speed_to_lead')).toEqual({
      key: 'speed_to_lead',
      unit: 'seconds',
      value: 60,
      previous: 120,
      betterWhen: 'lower',
      href: '/conversations',
      sample: { answered: 3, unanswered: 1 },
    });
  });

  it('sem resposta na janela anterior, previous é null (sem base), não zero', () => {
    const r = buildHomePayload(input('AGENT'));
    const stl = r.kpis.find((k) => k.key === 'speed_to_lead');
    expect(stl?.value).toBe(45);
    expect(stl?.previous).toBeNull();
  });

  it('sem tipo de conversão, receita e conversões são desconhecidas (null), não zero', () => {
    const r = buildHomePayload(
      input('OWNER', { workspace: { ...WORKSPACE, hasConversionTypes: false } }),
    );
    expect(r.kpis.find((k) => k.key === 'revenue')).toMatchObject({ value: null, previous: null });
    expect(r.kpis.find((k) => k.key === 'conversions')).toMatchObject({
      value: null,
      previous: null,
    });
    expect(r.revenueSeries).toBeNull();
    // Leads não dependem de tipo de conversão.
    expect(r.kpis.find((k) => k.key === 'leads')?.value).toBe(LEADS_EMPRESA);
  });

  it('declara a janela atual e a anterior que usou', () => {
    const r = buildHomePayload(input('OWNER', { periodDays: 7 }));
    expect(r.periodDays).toBe(7);
    expect(r.window).toEqual({
      from: '2026-09-08T18:00:00.000Z',
      to: '2026-09-15T18:00:00.000Z',
      previousFrom: '2026-09-01T18:00:00.000Z',
      previousTo: '2026-09-08T18:00:00.000Z',
    });
  });
});

describe('homeWindows', () => {
  it('janela anterior contígua e do mesmo tamanho, sem sobreposição', () => {
    for (const days of [7, 30, 90] as const) {
      const { current, previous } = homeWindows(AGORA, days);
      expect(current.to.getTime()).toBe(AGORA.getTime());
      expect(current.to.getTime() - current.from.getTime()).toBe(days * DIA);
      expect(previous.to.getTime()).toBe(current.from.getTime());
      expect(previous.to.getTime() - previous.from.getTime()).toBe(days * DIA);
    }
  });
});

describe('buildHomePayload — "precisa da sua atenção"', () => {
  it('crítico primeiro; cada item com rota e alvo da ação', () => {
    const r = buildHomePayload(input('OWNER'));
    expect(r.attention.map((a) => a.severity)).toEqual(['critical', 'critical', 'warning', 'info']);
    expect(r.attention).toEqual([
      {
        kind: 'waiting_sla',
        severity: 'critical',
        count: 1,
        oldestMinutes: 90,
        href: '/conversations/conv-1',
        targetId: 'conv-1',
      },
      {
        kind: 'channel_down',
        severity: 'critical',
        count: 1,
        oldestMinutes: null,
        href: '/settings/channels',
        targetId: 'chan-1',
      },
      {
        kind: 'deals_stalled',
        severity: 'warning',
        count: 4,
        oldestMinutes: null,
        href: '/pipeline',
        targetId: 'deal-9',
      },
      {
        kind: 'media_failed',
        severity: 'info',
        count: 2,
        oldestMinutes: null,
        href: '/conversations',
        targetId: 'conv-7',
      },
    ]);
  });

  it('espera abaixo de 1h é aviso; várias conversas levam à fila, não a uma', () => {
    const r = buildHomePayload(
      input('AGENT', {
        attention: {
          ...ATTENTION,
          waiting: {
            count: 3,
            oldestAt: new Date(AGORA.getTime() - 20 * 60_000),
            oldestConversationId: 'conv-2',
          },
        },
      }),
    );
    expect(r.attention.find((a) => a.kind === 'waiting_sla')).toMatchObject({
      severity: 'warning',
      count: 3,
      oldestMinutes: 20,
      href: '/conversations?status=open',
      targetId: 'conv-2',
    });
  });

  it('conexão Meta vencida sozinha leva às configurações da Meta', () => {
    const r = buildHomePayload(
      input('ADMIN', {
        attention: {
          ...ATTENTION,
          channelDown: { count: 0, onlyChannelId: null, metaLoginExpired: true },
        },
      }),
    );
    expect(r.attention.find((a) => a.kind === 'channel_down')).toMatchObject({
      count: 1,
      href: '/settings/meta',
      targetId: null,
    });
  });

  it('nada a fazer = lista vazia (não inventa atenção)', () => {
    const r = buildHomePayload(
      input('OWNER', {
        attention: {
          waiting: { count: 0, oldestAt: null, oldestConversationId: null },
          stalledDeals: { count: 0, oldestDealId: null },
          channelDown: { count: 0, onlyChannelId: null, metaLoginExpired: false },
          mediaFailed: { count: 0, latestConversationId: null },
        },
      }),
    );
    expect(r.attention).toEqual([]);
  });

  it('declara a régua de SLA que usou e de onde ela veio', () => {
    const r = buildHomePayload(input('OWNER', { sla: { minutes: 30, source: 'workspace_rule' } }));
    expect(r.thresholds).toMatchObject({ slaMinutes: 30, slaSource: 'workspace_rule' });
  });
});

describe('resolveSlaMinutes', () => {
  it('usa a regra de 1ª resposta do workspace, arredondando para cima', () => {
    expect(resolveSlaMinutes(1800)).toEqual({ minutes: 30, source: 'workspace_rule' });
    expect(resolveSlaMinutes(90)).toEqual({ minutes: 2, source: 'workspace_rule' });
  });

  it('sem regra (ou regra inválida), o padrão da Home', () => {
    for (const v of [null, undefined, 0, -5, Number.NaN]) {
      expect(resolveSlaMinutes(v)).toEqual({
        minutes: HOME_DEFAULT_SLA_MINUTES,
        source: 'default',
      });
    }
  });
});

describe('fillRevenueSeries', () => {
  it('um ponto por dia da janela, dias sem venda com 0', () => {
    const win = { from: new Date('2026-09-10T18:00:00Z'), to: new Date('2026-09-15T18:00:00Z') };
    const s = fillRevenueSeries(
      [
        { day: '2026-09-11', valueCents: 500 },
        { day: '2026-09-15', valueCents: 250 },
      ],
      win,
    );
    expect(s.map((p) => p.day)).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
    ]);
    expect(s.map((p) => p.valueCents)).toEqual([0, 500, 0, 0, 0, 250]);
  });

  it('preserva a soma: série == KPI para toda janela (inclusive os dias de borda parciais)', () => {
    // O SQL agrupa por dia UTC o mesmo conjunto do KPI (`countedConversions`); a
    // projeção não pode descartar nem duplicar dia — inclusive o 1º e o último.
    for (const days of [7, 30, 90] as const) {
      const win = homeWindows(AGORA, days);
      const first = win.current.from.toISOString().slice(0, 10);
      const last = new Date(win.current.to.getTime() - 1).toISOString().slice(0, 10);
      const rows = [
        { day: first, valueCents: 1_000 },
        { day: '2026-09-14', valueCents: 333 },
        { day: last, valueCents: 4_000 },
      ];
      const kpi = rows.reduce((acc, r) => acc + r.valueCents, 0);
      const s = fillRevenueSeries(rows, win.current);
      expect(s.reduce((acc, p) => acc + p.valueCents, 0)).toBe(kpi);
      expect(new Set(s.map((p) => p.day)).size).toBe(s.length);
    }
  });
});

describe('toFiniteNumber', () => {
  it('aceita número e string numérica do driver; rejeita o resto', () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber('60.5')).toBe(60.5);
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber('abc')).toBeNull();
  });
});
