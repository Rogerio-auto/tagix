/**
 * Testes das 3 métricas novas de Negócio (F55-S05): Placar IA×Humano, ROI da IA e
 * Funil de pipeline. Foco:
 *  - atribuição IA (`triggered_by_agent_id`) vs humano (`triggered_by_member_id`),
 *    líquido de `cancelled_at`;
 *  - ROI = receita IA ÷ custo IA (`llm_usage_logs` `is_test=false`), com custo 0 → `roi:null`;
 *  - funil por estágio (ordenado por `position`), win rate e ciclo médio dos ganhos;
 *  - visibilidade por role (cada card só para os roles certos — server-driven §8).
 *
 * Roda contra o Postgres local (infra Docker UP). Workspace isolado, semeado e sob RLS.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import type { Role } from '@hm/shared';
import { funilPipeline, placarIaHumano, roiIa } from '../queries';
import { metricsForRole, visibleMetricKeys } from '../metrics/registry';

const {
  workspaces,
  members,
  agents,
  contacts,
  conversionTypes,
  conversionEvents,
  llmUsageLogs,
  pipelines,
  stages,
  deals,
} = schema;

let ws = '';
let memberId = '';
let agentId = '';
let contactId = '';
let stageLeadId = '';
let stageWonId = '';

beforeAll(async () => {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(workspaces)
    .values({ name: 'DashNeg', slug: `dashneg-${sfx}` })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;

  const [m] = await db
    .insert(members)
    .values({
      workspaceId: ws,
      authUserId: randomUUID(),
      email: `dashneg-${sfx}@t.local`,
      name: 'Atendente',
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!m) throw new Error('member');
  memberId = m.id;

  const [ag] = await db
    .insert(agents)
    .values({ workspaceId: ws, name: 'Bot Vendas', systemPrompt: 'vende' })
    .returning();
  if (!ag) throw new Error('agent');
  agentId = ag.id;

  // Contatos distintos por evento de conversão: o índice de dedup
  // `uq_conv_events_dedup` proíbe 2 eventos no mesmo (contato, tipo, dia).
  const [c, cCancel, cHuman] = await db
    .insert(contacts)
    .values([
      { workspaceId: ws, displayName: 'Lead IA', phone: `+551190${sfx.slice(0, 6)}` },
      { workspaceId: ws, displayName: 'Lead IA cancel', phone: `+551191${sfx.slice(0, 6)}` },
      { workspaceId: ws, displayName: 'Lead humano', phone: `+551192${sfx.slice(0, 6)}` },
    ])
    .returning();
  if (!c || !cCancel || !cHuman) throw new Error('contact');
  contactId = c.id;

  const [ct] = await db
    .insert(conversionTypes)
    .values({ workspaceId: ws, key: 'venda', label: 'Venda' })
    .returning();
  if (!ct) throw new Error('conversion type');

  // Conversões do mês: 2 IA (1 cancelada → não conta) + 1 humano. Receita IA líquida
  // = 30000 (a cancelada de 99999 é ignorada). Receita humano = 20000.
  await db.insert(conversionEvents).values([
    {
      workspaceId: ws,
      conversionTypeId: ct.id,
      contactId,
      source: 'agent_tool',
      valueCents: 30000,
      triggeredByAgentId: agentId,
    },
    {
      workspaceId: ws,
      conversionTypeId: ct.id,
      contactId: cCancel.id,
      source: 'agent_tool',
      valueCents: 99999,
      triggeredByAgentId: agentId,
      cancelledAt: new Date(),
    },
    {
      workspaceId: ws,
      conversionTypeId: ct.id,
      contactId: cHuman.id,
      source: 'manual',
      valueCents: 20000,
      triggeredByMemberId: memberId,
    },
  ]);

  // Custo de IA do mês: 4 USD reais + 100 USD de teste (ignorado por is_test=true).
  await db.insert(llmUsageLogs).values([
    { workspaceId: ws, requestType: 'chat', model: 'openai/gpt-4o-mini', costUsd: '4.00000000' },
    {
      workspaceId: ws,
      requestType: 'chat',
      model: 'openai/gpt-4o-mini',
      costUsd: '100.00000000',
      isTest: true,
    },
  ]);

  // Pipeline com 2 estágios (Lead pos 0, Ganho pos 1). Deals: 2 abertos no Lead
  // (10000 + 5000), 1 ganho (closedWon) e 1 perdido fechados no mês.
  const [pl] = await db
    .insert(pipelines)
    .values({ workspaceId: ws, name: 'Vendas', isDefault: true })
    .returning();
  if (!pl) throw new Error('pipeline');
  const [sLead] = await db
    .insert(stages)
    .values({ workspaceId: ws, pipelineId: pl.id, name: 'Lead', position: 0 })
    .returning();
  const [sWon] = await db
    .insert(stages)
    .values({ workspaceId: ws, pipelineId: pl.id, name: 'Ganho', position: 1, isWon: true })
    .returning();
  if (!sLead || !sWon) throw new Error('stages');
  stageLeadId = sLead.id;
  stageWonId = sWon.id;

  const createdAt = new Date(Date.now() - 5 * 86400_000); // 5 dias atrás
  const closedAt = new Date(); // fechado agora → ciclo ≈ 5 dias
  await db.insert(deals).values([
    {
      workspaceId: ws,
      pipelineId: pl.id,
      stageId: stageLeadId,
      contactId,
      title: 'Aberto A',
      valueCents: 10000,
    },
    {
      workspaceId: ws,
      pipelineId: pl.id,
      stageId: stageLeadId,
      contactId,
      title: 'Aberto B',
      valueCents: 5000,
    },
    {
      workspaceId: ws,
      pipelineId: pl.id,
      stageId: stageWonId,
      contactId,
      title: 'Ganho',
      valueCents: 50000,
      createdAt,
      closedAt,
      closedWon: true,
    },
    {
      workspaceId: ws,
      pipelineId: pl.id,
      stageId: stageLeadId,
      contactId,
      title: 'Perdido',
      valueCents: 7000,
      closedAt,
      closedWon: false,
    },
  ]);
});

afterAll(async () => {
  const db = getDb();
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

describe('F55-S05 placarIaHumano', () => {
  it('separa conversões/receita IA vs humano, líquido de cancelamento', async () => {
    const out = await withWorkspace(ws, (tx) => placarIaHumano(tx));
    const ia = out['ia'] as { count: number; valueCents: number };
    const humano = out['humano'] as { count: number; valueCents: number };
    // 1 IA conta (a cancelada some); 1 humano.
    expect(ia.count).toBe(1);
    expect(ia.valueCents).toBe(30000);
    expect(humano.count).toBe(1);
    expect(humano.valueCents).toBe(20000);
  });
});

describe('F55-S05 roiIa', () => {
  it('receita IA ÷ custo IA (is_test ignorado), 2 casas', async () => {
    const out = await withWorkspace(ws, (tx) => roiIa(tx, ws));
    // receita IA líquida = 30000 cents = 300 BRL; custo = 4 USD (teste ignorado).
    expect(out['receitaCents']).toBe(30000);
    expect(out['custoUsd']).toBe(4);
    expect(out['roi']).toBe(75); // (30000/100)/4
  });

  it('custo 0 → roi null (sem divisão por zero)', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(workspaces)
      .values({ name: `RoiZero ${sfx}`, slug: `roizero-${sfx}` })
      .returning();
    if (!w) throw new Error('ws');
    try {
      const out = await withWorkspace(w.id, (tx) => roiIa(tx, w.id));
      expect(out['custoUsd']).toBe(0);
      expect(out['roi']).toBeNull();
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, w.id));
    }
  });
});

describe('F55-S05 funilPipeline', () => {
  it('valor aberto/contagem por estágio + win rate + ciclo médio dos ganhos', async () => {
    const out = await withWorkspace(ws, (tx) => funilPipeline(tx));
    expect(out.columns.map((c) => c.key)).toEqual(['stage', 'abertos', 'valor_aberto_cents']);
    // Ordenado por position: Lead (0) antes de Ganho (1).
    const lead = out.rows.find((r) => r['stageId'] === stageLeadId);
    const won = out.rows.find((r) => r['stageId'] === stageWonId);
    expect(out.rows.indexOf(lead!)).toBeLessThan(out.rows.indexOf(won!));
    // Lead: 2 deals abertos (10000 + 5000); o "Perdido" é fechado → não conta como aberto.
    expect(lead?.['abertos']).toBe(2);
    expect(lead?.['valor_aberto_cents']).toBe(15000);
    // Ganho: deal fechado → 0 aberto.
    expect(won?.['abertos']).toBe(0);
    expect(won?.['valor_aberto_cents']).toBe(0);
    // Win rate do mês: 2 fechados (1 ganho + 1 perdido), 1 ganho → 50%.
    expect(out['fechadosMes']).toBe(2);
    expect(out['ganhosMes']).toBe(1);
    expect(out['winRatePct']).toBe(50);
    // Ciclo médio dos ganhos ≈ 5 dias (em segundos) — tolerância ampla.
    const ciclo = out['cicloMedioSegundos'] as number;
    expect(ciclo).toBeGreaterThan(4 * 86400);
    expect(ciclo).toBeLessThan(6 * 86400);
  });
});

describe('F55-S05 visibilidade por role (server-driven §8)', () => {
  const has = (role: Role, key: string): boolean => visibleMetricKeys(role).includes(key);

  it('placar_ia_humano é SUP_UP e gated por conversion_type (AGENT/READONLY nunca)', () => {
    expect(has('SUPERVISOR', 'placar_ia_humano')).toBe(true);
    expect(has('ADMIN', 'placar_ia_humano')).toBe(true);
    expect(has('OWNER', 'placar_ia_humano')).toBe(true);
    expect(has('AGENT', 'placar_ia_humano')).toBe(false);
    expect(has('READONLY', 'placar_ia_humano')).toBe(false);
    // Gate: sem conversion_type configurado, some do conjunto.
    const supWithout = new Set(metricsForRole('SUPERVISOR', false).map((m) => m.key));
    expect(supWithout.has('placar_ia_humano')).toBe(false);
    const supWith = new Set(metricsForRole('SUPERVISOR', true).map((m) => m.key));
    expect(supWith.has('placar_ia_humano')).toBe(true);
  });

  it('roi_ia é ADMIN_RO (custo sensível): ADMIN/OWNER/READONLY sim, SUP/AGENT não', () => {
    expect(has('ADMIN', 'roi_ia')).toBe(true);
    expect(has('OWNER', 'roi_ia')).toBe(true);
    expect(has('READONLY', 'roi_ia')).toBe(true);
    expect(has('SUPERVISOR', 'roi_ia')).toBe(false);
    expect(has('AGENT', 'roi_ia')).toBe(false);
  });

  it('funil_pipeline é SUP_RO: SUP/ADMIN/OWNER/READONLY sim, AGENT não', () => {
    expect(has('SUPERVISOR', 'funil_pipeline')).toBe(true);
    expect(has('ADMIN', 'funil_pipeline')).toBe(true);
    expect(has('OWNER', 'funil_pipeline')).toBe(true);
    expect(has('READONLY', 'funil_pipeline')).toBe(true);
    expect(has('AGENT', 'funil_pipeline')).toBe(false);
  });

  it('cardType correto no catálogo (scoreboard/stat/table)', () => {
    const byKey = new Map(metricsForRole('OWNER', true).map((m) => [m.key, m]));
    expect(byKey.get('placar_ia_humano')?.cardType).toBe('scoreboard');
    expect(byKey.get('roi_ia')?.cardType).toBe('stat');
    expect(byKey.get('funil_pipeline')?.cardType).toBe('table');
  });
});
