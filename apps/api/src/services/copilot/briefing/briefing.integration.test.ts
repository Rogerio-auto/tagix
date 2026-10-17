/**
 * F73-S12 · geração, escopo e revalidação do briefing contra o Postgres de dev, com relógio
 * fixo (`BRIEFING_NOW`) e o mundo semeado de `test-fixtures.ts` (os números esperados estão
 * calculados no cabeçalho dele).
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import type { Briefing, Role } from '@hm/shared';
import { resolveCopilotPrincipal } from '../identity/principal';
import { loadWorkspaceFormat } from '../../../internal/copilot/read-crm/common';
import { collectLeadsWaiting, lazyTicket } from './candidates';
import { getOrCreateToday } from './generate';
import { registerBriefingSource } from './sources';
import {
  BRIEFING_DATE,
  BRIEFING_NOW,
  seedBriefingWorld,
  type BriefingWorld,
} from './test-fixtures';
import { BRIEFING_REVALIDATE_AFTER_MS } from './types';

const MIN = 60_000;
const HOUR = 3_600_000;

let world: BriefingWorld;
let empty: BriefingWorld;

beforeAll(async () => {
  world = await seedBriefingWorld({ label: 'BriefingGen' });
  empty = await seedBriefingWorld({ label: 'BriefingEmpty', empty: true });
});

afterAll(async () => {
  await world?.cleanup();
  await empty?.cleanup();
  await closeDb();
});

async function today(
  w: BriefingWorld,
  role: Role | { memberId: string },
  now: Date = BRIEFING_NOW,
  revalidate = true,
) {
  const memberId = typeof role === 'string' ? w.member(role) : role.memberId;
  return withWorkspace(w.workspaceId, async (tx) => {
    const principal = await resolveCopilotPrincipal(tx, {
      workspaceId: w.workspaceId,
      memberId,
      now,
    });
    if (!principal) throw new Error('principal');
    return getOrCreateToday(tx, principal, { now, revalidate });
  });
}

/** `Intl` separa moeda e número com U+00A0; o teste normaliza. */
const norm = (text: string): string => text.replace(/\u00a0/g, ' ');
const ids = (b: Briefing): string[] => b.items.map((i) => i.id);

describe('geração · OWNER (todos os tipos, ordem por receita em risco ponderada)', () => {
  let briefing: Briefing;

  it('gera ≤ 3 itens na ordem do score e conta o resto como overflow', async () => {
    const out = await today(world, 'OWNER');
    briefing = out.briefing;
    expect(out.created).toBe(true);
    expect(briefing.status).toBe('ready');
    expect(briefing.currency).toBe('BRL');
    expect(briefing.for_date).toBe(BRIEFING_DATE);
    expect(briefing.items).toHaveLength(3);
    expect(ids(briefing)).toEqual([
      `deals_idle:${world.stage.orcamento}`,
      'events_today',
      'leads_waiting',
    ]);
    // 6 candidatos (Orçamento, Novo, agenda, conversas, piloto, campanha): 3 ficam de fora.
    expect(briefing.overflow_count).toBe(3);
    expect(briefing.items.map((i) => i.priority)).toEqual(['high', 'medium', 'low']);
    expect(briefing.resolved_count).toBe(0);
    expect(briefing.seen_at).toBeNull();
  });

  it('os números de cada item batem com o mundo semeado', () => {
    const [idle, events, leads] = briefing.items;
    expect(idle?.value_at_risk).toBe(35_000);
    expect(norm(idle?.title ?? '')).toBe(
      '3 negócios sem resposta há 3+ dias · R$ 35.000 em Orçamento enviado',
    );
    expect(norm(idle?.why.join(' | ') ?? '')).toContain('R$ 35.000 em 3 negócios');
    expect(idle?.why.join(' ')).toContain('10 dias');
    expect(idle?.why.join(' ')).toContain('×1,25');
    // Existe o estágio "Reativação": a ação é um pedido pronto para o Copiloto.
    expect(idle?.action).toEqual({
      kind: 'ask',
      value: 'Mover os negócios parados há 3 dias ou mais em Orçamento enviado para Reativação',
      label: 'Mover para Reativação',
    });

    expect(events?.value_at_risk).toBe(30_000);
    expect(norm(events?.title ?? '')).toBe(
      '2 compromissos de hoje sem confirmação · R$ 30.000 em negócios ligados',
    );
    expect(events?.why.join(' ')).toContain('×1,35');

    expect(leads?.value_at_risk).toBe(9_000);
    expect(leads?.title).toBe('3 conversas esperando resposta, a mais antiga há 90 min');
    expect(norm(leads?.why[0] ?? '')).toContain('3 × ticket médio de R$ 3.000');
    expect(leads?.action).toMatchObject({ kind: 'navigate', value: '/hoje' });
    for (const item of briefing.items) {
      expect(new Date(item.as_of).getTime()).toBe(BRIEFING_NOW.getTime());
      expect(item.source.length).toBeGreaterThan(0);
    }
  });

  it('grava o snapshot do dia com os metadados de revalidação (fora da API)', async () => {
    const [row] = await getDb()
      .select()
      .from(schema.copilotBriefings)
      .where(
        and(
          eq(schema.copilotBriefings.workspaceId, world.workspaceId),
          eq(schema.copilotBriefings.memberId, world.member('OWNER')),
        ),
      );
    expect(row?.forDate).toBe(BRIEFING_DATE);
    expect(row?.items).toHaveLength(3);
    expect(row?.overflowCount).toBe(3);
    const first = (row?.items ?? [])[0] as Record<string, unknown> | undefined;
    expect(first?.['_meta']).toMatchObject({ v: 1, kind: 'deals_idle' });
    // O que sai pela API não tem `_meta`.
    expect(JSON.stringify(briefing)).not.toContain('_meta');
  });

  it('é idempotente por (membro, data): a 2ª chamada devolve o MESMO briefing, sem regerar', async () => {
    const again = await today(world, 'OWNER', new Date(BRIEFING_NOW.getTime() + 20 * MIN));
    expect(again.created).toBe(false);
    expect(again.briefing.id).toBe(briefing.id);
    expect(again.briefing.generated_at).toBe(briefing.generated_at);
    const rows = await getDb()
      .select({ id: schema.copilotBriefings.id })
      .from(schema.copilotBriefings)
      .where(
        and(
          eq(schema.copilotBriefings.workspaceId, world.workspaceId),
          eq(schema.copilotBriefings.memberId, world.member('OWNER')),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('um novo dia local gera um novo briefing (data no fuso do workspace)', async () => {
    const tomorrow = await today(world, 'OWNER', new Date(BRIEFING_NOW.getTime() + 20 * HOUR));
    expect(tomorrow.created).toBe(true);
    expect(tomorrow.briefing.for_date).toBe('2026-10-18');
    expect(tomorrow.briefing.id).not.toBe(briefing.id);
  });
});

describe('escopo · AGENT só vê o que é dele (dois agentes)', () => {
  it('agente A: só os negócios, conversas e sugestões dele', async () => {
    const { briefing } = await today(world, 'AGENT');
    const byId = new Map(briefing.items.map((i) => [i.id, i]));
    const idle = byId.get(`deals_idle:${world.stage.orcamento}`);
    // A1 + A2 (R$ 15.000). O B1 (R$ 20.000) é do agente B e não pode nem somar.
    expect(idle?.value_at_risk).toBe(15_000);
    expect(norm(idle?.title ?? '')).toContain('2 negócios');
    // Compromissos visíveis na agenda da empresa (2), mas o valor soma só o negócio que ele vê (A1).
    expect(byId.get('events_today')?.value_at_risk).toBe(10_000);
    // Piloto: a sugestão é do A1.
    expect(byId.get('autopilot_pending')?.value_at_risk).toBe(10_000);
    // Sem permissão de campanha: nunca aparece.
    expect(briefing.items.some((i) => i.kind === 'campaign_issue')).toBe(false);
    // Nenhum item traz o valor do agente B (R$ 20.000).
    expect(briefing.items.some((i) => i.value_at_risk === 20_000)).toBe(false);
    expect(norm(JSON.stringify(briefing.items.map((i) => [i.title, i.why])))).not.toContain(
      '20.000',
    );
    // 4 candidatos (parados, agenda, piloto, conversas): 3 no briefing, 1 de overflow.
    expect(briefing.items).toHaveLength(3);
    expect(briefing.overflow_count).toBe(1);
  });

  it('agente A: a fila de conversas é a dele (2 de 3), pela mesma régua do Hoje', async () => {
    const leads = await withWorkspace(world.workspaceId, async (tx) => {
      const principal = await resolveCopilotPrincipal(tx, {
        workspaceId: world.workspaceId,
        memberId: world.agentA,
        now: BRIEFING_NOW,
      });
      if (!principal) throw new Error('principal');
      const fmt = await loadWorkspaceFormat(tx, world.workspaceId);
      const ctx = { principal, fmt, now: BRIEFING_NOW, forDate: BRIEFING_DATE };
      return collectLeadsWaiting(tx, ctx, lazyTicket(tx, ctx));
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]?.facts).toMatchObject({
      kind: 'leads_waiting',
      count: 2,
      oldestWaitingMinutes: 35,
      ticket: 2_000,
      ticketBasis: 'won_90d',
    });
    expect(leads[0]?.valueAtRisk).toBe(4_000);
  });

  it('agente B: vê B1 e a conversa dele, e nenhum valor do agente A', async () => {
    const { briefing } = await today(world, { memberId: world.agentB });
    const byId = new Map(briefing.items.map((i) => [i.id, i]));
    expect(byId.get(`deals_idle:${world.stage.orcamento}`)?.value_at_risk).toBe(20_000);
    expect(byId.get('events_today')?.value_at_risk).toBe(20_000);
    expect(norm(byId.get('leads_waiting')?.why[0] ?? '')).toContain('1 × ticket médio de R$ 4.000');
    expect(byId.has('autopilot_pending')).toBe(false);
    expect(briefing.items.some((i) => i.value_at_risk === 15_000)).toBe(false);
    expect(briefing.items).toHaveLength(3);
    expect(briefing.overflow_count).toBe(0);
  });

  it('papel sem nada para mostrar recebe `empty` (sem inventar item)', async () => {
    const { briefing } = await today(empty, 'OWNER');
    expect(briefing.status).toBe('empty');
    expect(briefing.items).toEqual([]);
    expect(briefing.overflow_count).toBe(0);
  });
});

describe('revalidação · dado velho não vira fato', () => {
  afterEach(async () => {
    // Devolve o mundo ao estado inicial entre os testes.
    const DAY = 86_400_000;
    for (const [title, days] of [['A1', 10], ['A2', 4], ['B1', 8]] as const) {
      await getDb()
        .update(schema.deals)
        .set({
          stageId: world.stage.orcamento,
          updatedAt: new Date(BRIEFING_NOW.getTime() - days * DAY - HOUR),
        })
        .where(and(eq(schema.deals.workspaceId, world.workspaceId), eq(schema.deals.title, title)));
    }
    await getDb()
      .update(schema.events)
      .set({ status: 'scheduled' })
      .where(
        and(
          eq(schema.events.workspaceId, world.workspaceId),
          sql`${schema.events.title} in ('E1','E2')`,
        ),
      );
  });

  /** Gera o briefing do OWNER no instante fixo e envelhece `generated_at` para o mesmo instante. */
  async function freshSnapshot(): Promise<Briefing> {
    await getDb()
      .delete(schema.copilotBriefings)
      .where(eq(schema.copilotBriefings.workspaceId, world.workspaceId));
    const { briefing } = await today(world, 'OWNER');
    await getDb()
      .update(schema.copilotBriefings)
      .set({ generatedAt: BRIEFING_NOW })
      .where(eq(schema.copilotBriefings.workspaceId, world.workspaceId));
    return briefing;
  }

  it('até 60 min depois: devolve o snapshot sem reconferir (mesmo que o mundo tenha mudado)', async () => {
    const before = await freshSnapshot();
    await getDb()
      .update(schema.deals)
      .set({ stageId: world.stage.reativacao })
      .where(eq(schema.deals.id, world.deal.A1));
    const within = new Date(BRIEFING_NOW.getTime() + BRIEFING_REVALIDATE_AFTER_MS - MIN);
    const out = await today(world, 'OWNER', within);
    expect(out.briefing.items[0]?.value_at_risk).toBe(before.items[0]?.value_at_risk);
    expect(out.briefing.resolved_count).toBe(0);
  });

  it('negócio movido depois da geração sai do item (atualiza os números, sem inventar)', async () => {
    await freshSnapshot();
    // A1 (R$ 10.000) saiu do Orçamento enviado depois da geração.
    await getDb()
      .update(schema.deals)
      .set({ stageId: world.stage.reativacao, updatedAt: new Date(BRIEFING_NOW.getTime() + HOUR) })
      .where(eq(schema.deals.id, world.deal.A1));
    const later = new Date(BRIEFING_NOW.getTime() + 90 * MIN);
    const out = await today(world, 'OWNER', later);
    const idle = out.briefing.items.find((i) => i.id === `deals_idle:${world.stage.orcamento}`);
    expect(idle?.value_at_risk).toBe(25_000);
    expect(norm(idle?.title ?? '')).toContain('2 negócios');
    expect(new Date(idle?.as_of ?? '').getTime()).toBe(later.getTime());
    expect(out.briefing.resolved_count).toBe(0);
    expect(out.briefing.data_as_of).toBe(later.toISOString());
    // O snapshot gravado NÃO muda (a revalidação não regrava).
    expect(out.row.items).toHaveLength(3);
  });

  it('todos os negócios do item movidos e compromissos confirmados: "2 já resolvidos"', async () => {
    await freshSnapshot();
    await getDb()
      .update(schema.deals)
      .set({ stageId: world.stage.reativacao, updatedAt: new Date(BRIEFING_NOW.getTime() + HOUR) })
      .where(
        and(
          eq(schema.deals.workspaceId, world.workspaceId),
          sql`${schema.deals.title} in ('A1','A2','B1')`,
        ),
      );
    await getDb()
      .update(schema.events)
      .set({ status: 'confirmed' })
      .where(
        and(
          eq(schema.events.workspaceId, world.workspaceId),
          sql`${schema.events.title} in ('E1','E2')`,
        ),
      );
    const out = await today(world, 'OWNER', new Date(BRIEFING_NOW.getTime() + 90 * MIN));
    expect(out.briefing.resolved_count).toBe(2);
    expect(ids(out.briefing)).toEqual(['leads_waiting']);
    expect(out.briefing.status).toBe('ready');
  });

  it('se tudo foi resolvido: `empty` e a contagem de resolvidos', async () => {
    // Briefing só com o item de conversas é revalidado contra conversas já respondidas.
    await freshSnapshot();
    await getDb()
      .update(schema.conversations)
      .set({ lastMessageFrom: 'member' })
      .where(eq(schema.conversations.workspaceId, world.workspaceId));
    await getDb()
      .update(schema.deals)
      .set({ stageId: world.stage.reativacao, updatedAt: new Date(BRIEFING_NOW.getTime() + HOUR) })
      .where(
        and(
          eq(schema.deals.workspaceId, world.workspaceId),
          sql`${schema.deals.title} in ('A1','A2','B1')`,
        ),
      );
    await getDb()
      .update(schema.events)
      .set({ status: 'confirmed' })
      .where(
        and(
          eq(schema.events.workspaceId, world.workspaceId),
          sql`${schema.events.title} in ('E1','E2')`,
        ),
      );
    try {
      const out = await today(world, 'OWNER', new Date(BRIEFING_NOW.getTime() + 90 * MIN));
      expect(out.briefing.items).toEqual([]);
      expect(out.briefing.resolved_count).toBe(3);
      expect(out.briefing.status).toBe('empty');
    } finally {
      await getDb()
        .update(schema.conversations)
        .set({ lastMessageFrom: 'contact' })
        .where(eq(schema.conversations.workspaceId, world.workspaceId));
    }
  });
});

describe('fonte velha (seam integration_alert da F75)', () => {
  const FRESH = (asOf: Date) => ({
    kind: 'integration_alert' as const,
    key: 'integration_alert:wa-token',
    valueAtRisk: 500,
    urgency: 0,
    oldestAt: asOf,
    facts: {
      kind: 'integration_alert' as const,
      title: 'O token do WhatsApp expira em 2 dias',
      why: ['Conexão principal', 'Sem renovação automática'],
      action: { kind: 'navigate' as const, value: '/settings', label: 'Renovar' },
    },
    refs: {},
    source: 'Integrações',
    asOf,
  });

  it('dado da fonte mais velho que o limite não entra no briefing', async () => {
    const unregister = registerBriefingSource({
      id: 'test-old',
      maxAgeMs: 45 * MIN,
      collect: async () => [FRESH(new Date(BRIEFING_NOW.getTime() - 2 * HOUR))],
    });
    try {
      const { briefing } = await today(empty, 'ADMIN', BRIEFING_NOW);
      expect(briefing.items).toEqual([]);
      expect(briefing.status).toBe('empty');
    } finally {
      unregister();
    }
  });

  it('item cuja fonte não pode ser reconferida sai quando o dado passa do limite; `stale` se não sobra nada', async () => {
    const unregister = registerBriefingSource({
      id: 'test-norecheck',
      maxAgeMs: 45 * MIN,
      collect: async () => [FRESH(new Date(BRIEFING_NOW.getTime() - 10 * MIN))],
    });
    try {
      const first = await today(empty, 'SUPERVISOR', BRIEFING_NOW);
      expect(first.briefing.items).toHaveLength(1);
      expect(first.briefing.items[0]?.kind).toBe('integration_alert');
      expect(first.briefing.items[0]?.title).toBe('O token do WhatsApp expira em 2 dias');
      await getDb()
        .update(schema.copilotBriefings)
        .set({ generatedAt: BRIEFING_NOW })
        .where(eq(schema.copilotBriefings.id, first.briefing.id));
      // 90 min depois o dado tem 100 min (limite 45): não é mais fato.
      const later = await today(empty, 'SUPERVISOR', new Date(BRIEFING_NOW.getTime() + 90 * MIN));
      expect(later.briefing.items).toEqual([]);
      expect(later.briefing.status).toBe('stale');
      expect(later.briefing.resolved_count).toBe(0);
    } finally {
      unregister();
    }
  });

  it('com `recheck`, o provedor decide: resolvido sai como "já resolvido"', async () => {
    const unregister = registerBriefingSource({
      id: 'test-recheck',
      maxAgeMs: 45 * MIN,
      collect: async () => [FRESH(new Date(BRIEFING_NOW.getTime() - 5 * MIN))],
      recheck: async () => null,
    });
    try {
      const first = await today(empty, 'READONLY', BRIEFING_NOW);
      expect(first.briefing.items).toHaveLength(1);
      await getDb()
        .update(schema.copilotBriefings)
        .set({ generatedAt: BRIEFING_NOW })
        .where(eq(schema.copilotBriefings.id, first.briefing.id));
      const later = await today(empty, 'READONLY', new Date(BRIEFING_NOW.getTime() + 90 * MIN));
      expect(later.briefing.items).toEqual([]);
      expect(later.briefing.resolved_count).toBe(1);
      expect(later.briefing.status).toBe('empty');
    } finally {
      unregister();
    }
  });
});
