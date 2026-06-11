/**
 * Testes do server-driven dashboard (F8-S02 / DASHBOARD.md §8). Foco no requisito
 * fundador: o servidor retorna conjuntos de cards DIFERENTES por role (AGENT vs
 * SUPERVISOR vs ADMIN vs OWNER vs READONLY) — nunca o front filtrando por role.
 *
 * Roda contra o Postgres local (infra Docker UP). Cria um workspace isolado, semeia
 * conversas/contatos e exercita loadDashboard sob RLS para cada role.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import type { Role } from '@hm/shared';
import { loadDashboard, visibleMetricKeys } from './load-dashboard';
import { metricsForRole } from './definitions';

const { workspaces, members, contacts, conversations, channels, conversionTypes, plans } = schema;

let ws = '';
let memberId = '';

beforeAll(async () => {
  const db = getDb();
  const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(workspaces)
    .values({ name: 'DashSvc', slug: `dashsvc-${sfx}`, planId: free?.id ?? null })
    .returning();
  if (!w) throw new Error('ws');
  ws = w.id;

  const [m] = await db
    .insert(members)
    .values({
      workspaceId: ws,
      authUserId: randomUUID(),
      email: `dash-${sfx}@t.local`,
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!m) throw new Error('member');
  memberId = m.id;

  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: ws,
      provider: 'meta_whatsapp',
      name: `WA ${sfx}`,
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  if (!ch) throw new Error('channel');

  // 2 conversas atribuídas ao member (1 open, 1 pending) + 1 IA-on não atribuída.
  await db.insert(conversations).values([
    {
      workspaceId: ws,
      channelId: ch.id,
      remoteId: `r1-${sfx}`,
      status: 'open',
      assignedTo: memberId,
    },
    {
      workspaceId: ws,
      channelId: ch.id,
      remoteId: `r2-${sfx}`,
      status: 'pending',
      assignedTo: memberId,
    },
    {
      workspaceId: ws,
      channelId: ch.id,
      remoteId: `r3-${sfx}`,
      status: 'pending',
      aiMode: 'on',
    },
  ]);
  await db.insert(contacts).values({ workspaceId: ws, displayName: 'Lead', phone: `+551190${sfx.slice(0, 6)}` });
});

afterAll(async () => {
  const db = getDb();
  if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
  await closeDb();
});

const ROLES: Role[] = ['AGENT', 'SUPERVISOR', 'ADMIN', 'OWNER', 'READONLY'];

describe('dashboard server-driven: card set por role (§8)', () => {
  it('cada role recebe um conjunto de cards distinto', async () => {
    const setsByRole = new Map<Role, Set<string>>();
    for (const role of ROLES) {
      const payload = await withWorkspace(ws, (tx) =>
        loadDashboard(tx, { workspaceId: ws, memberId, role }),
      );
      setsByRole.set(role, new Set(payload.cards.map((c) => c.key)));
    }

    // AGENT vê suas operacionais e NÃO vê custo IA (card admin).
    const agent = setsByRole.get('AGENT')!;
    expect(agent.has('minhas_conversas_abertas')).toBe(true);
    expect(agent.has('custo_llm_hoje_usd')).toBe(false);
    expect(agent.has('aguardando_atribuicao')).toBe(false); // métrica de supervisão

    // SUPERVISOR vê fila + volumes, mas não custo IA (ADMIN+).
    const sup = setsByRole.get('SUPERVISOR')!;
    expect(sup.has('aguardando_atribuicao')).toBe(true);
    expect(sup.has('volume_inbound_24h')).toBe(true);
    expect(sup.has('custo_llm_hoje_usd')).toBe(false);
    expect(sup.has('minhas_conversas_abertas')).toBe(false); // pessoal de agente

    // ADMIN vê custo IA; OWNER vê negócio (novos contatos) que ADMIN não vê.
    const admin = setsByRole.get('ADMIN')!;
    const owner = setsByRole.get('OWNER')!;
    expect(admin.has('custo_llm_hoje_usd')).toBe(true);
    expect(admin.has('novos_contatos_mes')).toBe(false);
    expect(owner.has('novos_contatos_mes')).toBe(true);
    expect(owner.has('custo_llm_hoje_usd')).toBe(true); // aditivo

    // READONLY: mesma visão informativa do ADMIN (sem ação) — vê custo IA.
    const readonly = setsByRole.get('READONLY')!;
    expect(readonly.has('custo_llm_hoje_usd')).toBe(true);
    expect(readonly.has('aguardando_atribuicao')).toBe(true);

    // Os 5 conjuntos não são todos iguais (server decide, não o front).
    const serialized = ROLES.map((r) => [...setsByRole.get(r)!].sort().join(','));
    expect(new Set(serialized).size).toBeGreaterThan(1);
  });

  it('valores live refletem o seed (AGENT)', async () => {
    const payload = await withWorkspace(ws, (tx) =>
      loadDashboard(tx, { workspaceId: ws, memberId, role: 'AGENT' }),
    );
    const open = payload.cards.find((c) => c.key === 'minhas_conversas_abertas');
    const fila = payload.cards.find((c) => c.key === 'minha_fila_pendente');
    expect(open?.value?.['count']).toBe(1);
    expect(fila?.value?.['count']).toBe(1);
  });

  it('em_atendimento_ia conta conversas com aiMode=on (SUPERVISOR)', async () => {
    const payload = await withWorkspace(ws, (tx) =>
      loadDashboard(tx, { workspaceId: ws, memberId, role: 'SUPERVISOR' }),
    );
    const ia = payload.cards.find((c) => c.key === 'em_atendimento_ia');
    expect(ia?.value?.['count']).toBe(1);
  });
});

describe('dashboard: gate de conversão (§13/§2.5)', () => {
  it('cards de conversão só aparecem com ≥1 conversion_type', async () => {
    // Sem conversion_type ainda → conversoes_minhas_mes ausente p/ AGENT.
    const before = await withWorkspace(ws, (tx) =>
      loadDashboard(tx, { workspaceId: ws, memberId, role: 'AGENT' }),
    );
    expect(before.cards.some((c) => c.key === 'conversoes_minhas_mes')).toBe(false);

    // Cria um conversion_type → o card passa a aparecer.
    await getDb()
      .insert(conversionTypes)
      .values({ workspaceId: ws, key: 'venda', label: 'Venda' });
    const after = await withWorkspace(ws, (tx) =>
      loadDashboard(tx, { workspaceId: ws, memberId, role: 'AGENT' }),
    );
    expect(after.cards.some((c) => c.key === 'conversoes_minhas_mes')).toBe(true);
  });
});

describe('dashboard: definições (puro, sem DB)', () => {
  it('visibleMetricKeys é monotônico na hierarquia AGENT⊂SUP? (não — escopos distintos)', () => {
    // AGENT tem cards pessoais que SUP não tem; SUP tem cards de equipe. São disjuntos
    // em parte — o que garante telas diferentes (não um superset trivial).
    const agent = new Set(visibleMetricKeys('AGENT'));
    const sup = new Set(visibleMetricKeys('SUPERVISOR'));
    expect(agent.has('minhas_conversas_abertas')).toBe(true);
    expect(sup.has('minhas_conversas_abertas')).toBe(false);
    expect(sup.has('aguardando_atribuicao')).toBe(true);
  });

  it('metricsForRole respeita o gate de conversão', () => {
    const withGate = metricsForRole('OWNER', true).map((m) => m.key);
    const without = metricsForRole('OWNER', false).map((m) => m.key);
    expect(withGate).toContain('conversoes_workspace_mes');
    expect(without).not.toContain('conversoes_workspace_mes');
  });
});
