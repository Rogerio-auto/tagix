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
import { drillDown } from './drill-down';
import { metricsForRole } from './metrics/registry';

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

describe('dashboard: contrato de card-set por role (F55-S04 — registry declarativo)', () => {
  // Conjunto EXATO de keys por role, na ordem do registry (= ordem de exibição §2).
  // Trava o contrato server-driven: qualquer mudança acidental de visibilidade/ordem
  // quebra aqui. Refactor do switch→registry tem que preservar isto byte a byte.
  const EXPECTED: Record<Role, string[]> = {
    AGENT: [
      'minhas_conversas_abertas',
      'minha_fila_pendente',
      'em_atendimento_ia',
      'resolvidas_hoje_por_mim',
      'conversoes_minhas_mes',
      'tempo_medio_primeira_resposta_24h',
    ],
    SUPERVISOR: [
      'aguardando_atribuicao',
      'em_atendimento_ia',
      'sla_violado_hoje',
      'resolvidas_hoje_por_mim',
      'volume_inbound_24h',
      'volume_outbound_24h',
      'inbox_por_departamento',
      'valor_total_pipeline',
      'deals_fechados_ganho_mes',
      'conversoes_minhas_mes',
      'conversoes_workspace_mes',
      'valor_convertido_workspace_mes',
      'conversoes_por_tipo',
      'performance_por_atendente',
      'tempo_medio_primeira_resposta_24h',
      'tempo_medio_resolucao_24h',
      'inbox_por_canal',
      'transferencias_24h',
      'agente_handoffs_24h',
      'agente_resolucoes_24h',
      'conversoes_por_atendente_humano',
      'conversoes_por_agente_ia',
      'qualidade_resposta_media',
      'qualidade_por_agente',
      'qualidade_por_atendente',
      'satisfacao_media',
      'objecoes_rankeadas',
      'leaderboard_produtividade',
      'leads_recentes',
      'desempenho_30d',
      'placar_ia_humano',
      'funil_pipeline',
    ],
    ADMIN: [
      'aguardando_atribuicao',
      'em_atendimento_ia',
      'sla_violado_hoje',
      'resolvidas_hoje_por_mim',
      'volume_inbound_24h',
      'volume_outbound_24h',
      'inbox_por_departamento',
      'valor_total_pipeline',
      'deals_fechados_ganho_mes',
      'custo_llm_hoje_usd',
      'custo_llm_mes_usd',
      'conversoes_minhas_mes',
      'conversoes_workspace_mes',
      'valor_convertido_workspace_mes',
      'conversoes_por_tipo',
      'performance_por_atendente',
      'tempo_medio_primeira_resposta_24h',
      'tempo_medio_resolucao_24h',
      'inbox_por_canal',
      'transferencias_24h',
      'agente_handoffs_24h',
      'agente_resolucoes_24h',
      'latencia_agente_p95_24h',
      'tokens_por_modelo_24h',
      'cap_mensal_consumido_pct',
      'conversoes_por_atendente_humano',
      'conversoes_por_agente_ia',
      'qualidade_resposta_media',
      'qualidade_por_agente',
      'qualidade_por_atendente',
      'satisfacao_media',
      'objecoes_rankeadas',
      'leaderboard_produtividade',
      'leads_recentes',
      'desempenho_30d',
      'placar_ia_humano',
      'roi_ia',
      'funil_pipeline',
    ],
    OWNER: [
      'aguardando_atribuicao',
      'em_atendimento_ia',
      'sla_violado_hoje',
      'volume_inbound_24h',
      'volume_outbound_24h',
      'inbox_por_departamento',
      'valor_total_pipeline',
      'deals_fechados_ganho_mes',
      'custo_llm_hoje_usd',
      'custo_llm_mes_usd',
      'conversoes_minhas_mes',
      'conversoes_workspace_mes',
      'valor_convertido_workspace_mes',
      'conversoes_por_tipo',
      'novos_contatos_mes',
      'contatos_total_workspace',
      'performance_por_atendente',
      'tempo_medio_primeira_resposta_24h',
      'tempo_medio_resolucao_24h',
      'inbox_por_canal',
      'transferencias_24h',
      'agente_handoffs_24h',
      'agente_resolucoes_24h',
      'latencia_agente_p95_24h',
      'tokens_por_modelo_24h',
      'cap_mensal_consumido_pct',
      'conversoes_por_atendente_humano',
      'conversoes_por_agente_ia',
      'qualidade_resposta_media',
      'qualidade_por_agente',
      'qualidade_por_atendente',
      'satisfacao_media',
      'objecoes_rankeadas',
      'leaderboard_produtividade',
      'leads_recentes',
      'desempenho_30d',
      'placar_ia_humano',
      'roi_ia',
      'funil_pipeline',
    ],
    READONLY: [
      'aguardando_atribuicao',
      'em_atendimento_ia',
      'sla_violado_hoje',
      'volume_inbound_24h',
      'volume_outbound_24h',
      'inbox_por_departamento',
      'valor_total_pipeline',
      'deals_fechados_ganho_mes',
      'custo_llm_hoje_usd',
      'custo_llm_mes_usd',
      'performance_por_atendente',
      'tempo_medio_primeira_resposta_24h',
      'tempo_medio_resolucao_24h',
      'inbox_por_canal',
      'latencia_agente_p95_24h',
      'tokens_por_modelo_24h',
      'cap_mensal_consumido_pct',
      'qualidade_resposta_media',
      'qualidade_por_agente',
      'qualidade_por_atendente',
      'satisfacao_media',
      'leaderboard_produtividade',
      'leads_recentes',
      'desempenho_30d',
      'roi_ia',
      'funil_pipeline',
    ],
  };

  it('visibleMetricKeys retorna o conjunto exato (ordem e composição) por role', () => {
    for (const role of ROLES) {
      expect(visibleMetricKeys(role)).toEqual(EXPECTED[role]);
    }
  });

  it('loadDashboard (com gate de conversão) entrega exatamente o card-set do role', async () => {
    // hasConversionType=true neste ws (criado num teste anterior) → os cards gated
    // entram, batendo com visibleMetricKeys (que ignora o gate).
    for (const role of ROLES) {
      const payload = await withWorkspace(ws, (tx) =>
        loadDashboard(tx, { workspaceId: ws, memberId, role }),
      );
      expect(payload.cards.map((c) => c.key)).toEqual(EXPECTED[role]);
    }
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

describe('dashboard Onda A: visibilidade por role das métricas novas (F28-S01)', () => {
  it('performance/inbox/transferências são de supervisão+ (não vazam pro AGENT)', () => {
    const agent = new Set(visibleMetricKeys('AGENT'));
    const sup = new Set(visibleMetricKeys('SUPERVISOR'));
    const admin = new Set(visibleMetricKeys('ADMIN'));

    // SUP_RO: performance por atendente, inbox por canal, resolução média.
    expect(sup.has('performance_por_atendente')).toBe(true);
    expect(sup.has('inbox_por_canal')).toBe(true);
    expect(sup.has('tempo_medio_resolucao_24h')).toBe(true);
    expect(agent.has('performance_por_atendente')).toBe(false);
    expect(agent.has('inbox_por_canal')).toBe(false);

    // Transferências: SUP_UP (não READONLY no spec? — é SUP/ADMIN). AGENT não vê.
    expect(sup.has('transferencias_24h')).toBe(true);
    expect(agent.has('transferencias_24h')).toBe(false);

    // 1ª resposta: AGENT vê (própria média); SUP+ vê do team.
    expect(agent.has('tempo_medio_primeira_resposta_24h')).toBe(true);
    expect(sup.has('tempo_medio_primeira_resposta_24h')).toBe(true);

    // IA ops: handoffs/resoluções SUP+; latência p95/tokens/cap são ADMIN+.
    expect(sup.has('agente_handoffs_24h')).toBe(true);
    expect(sup.has('latencia_agente_p95_24h')).toBe(false);
    expect(admin.has('latencia_agente_p95_24h')).toBe(true);
    expect(admin.has('tokens_por_modelo_24h')).toBe(true);
    expect(admin.has('cap_mensal_consumido_pct')).toBe(true);
  });

  it('rankings de conversão são SUP_UP e gated por conversion_type', () => {
    const supWith = new Set(metricsForRole('SUPERVISOR', true).map((m) => m.key));
    const supWithout = new Set(metricsForRole('SUPERVISOR', false).map((m) => m.key));
    expect(supWith.has('conversoes_por_atendente_humano')).toBe(true);
    expect(supWith.has('conversoes_por_agente_ia')).toBe(true);
    // Sem conversion_type configurado, os rankings somem (não card vazio).
    expect(supWithout.has('conversoes_por_atendente_humano')).toBe(false);
    expect(supWithout.has('conversoes_por_agente_ia')).toBe(false);

    // AGENT nunca vê ranking de equipe.
    const agent = new Set(metricsForRole('AGENT', true).map((m) => m.key));
    expect(agent.has('conversoes_por_atendente_humano')).toBe(false);
  });

  it('loadDashboard resolve os novos cards sem erro e com value/null coerente (ADMIN)', async () => {
    const payload = await withWorkspace(ws, (tx) =>
      loadDashboard(tx, { workspaceId: ws, memberId, role: 'ADMIN' }),
    );
    const keys = new Set(payload.cards.map((c) => c.key));
    expect(keys.has('performance_por_atendente')).toBe(true);
    expect(keys.has('tokens_por_modelo_24h')).toBe(true);
    expect(keys.has('cap_mensal_consumido_pct')).toBe(true);

    // Tabela column-aware: contrato { columns, rows }.
    const perf = payload.cards.find((c) => c.key === 'performance_por_atendente');
    expect(Array.isArray(perf?.value?.['columns'])).toBe(true);
    expect(Array.isArray(perf?.value?.['rows'])).toBe(true);

    // Cap sem policy definida → value null (front omite), sem lançar.
    const cap = payload.cards.find((c) => c.key === 'cap_mensal_consumido_pct');
    expect(cap?.value).toBeDefined();
  });
});

describe('dashboard Onda B: qualidade / CSAT / objeções (F29-S04)', () => {
  it('métricas qualitativas são de supervisão+ (não vazam pro AGENT — §10)', () => {
    const agent = new Set(visibleMetricKeys('AGENT'));
    const sup = new Set(visibleMetricKeys('SUPERVISOR'));
    const admin = new Set(visibleMetricKeys('ADMIN'));
    const readonly = new Set(visibleMetricKeys('READONLY'));

    // SUP_RO: qualidade média/por agente/por atendente + CSAT. READONLY informativo.
    for (const key of [
      'qualidade_resposta_media',
      'qualidade_por_agente',
      'qualidade_por_atendente',
      'satisfacao_media',
    ]) {
      expect(sup.has(key)).toBe(true);
      expect(admin.has(key)).toBe(true);
      expect(readonly.has(key)).toBe(true);
      // AGENT nunca vê avaliação de pares.
      expect(agent.has(key)).toBe(false);
    }

    // objeções rankeadas: SUP_UP (ação) — não READONLY, não AGENT.
    expect(sup.has('objecoes_rankeadas')).toBe(true);
    expect(admin.has('objecoes_rankeadas')).toBe(true);
    expect(readonly.has('objecoes_rankeadas')).toBe(false);
    expect(agent.has('objecoes_rankeadas')).toBe(false);
  });

  it('loadDashboard resolve as métricas Onda B com value null sem dados (SUPERVISOR)', async () => {
    const payload = await withWorkspace(ws, (tx) =>
      loadDashboard(tx, { workspaceId: ws, memberId, role: 'SUPERVISOR' }),
    );
    const keys = new Set(payload.cards.map((c) => c.key));
    expect(keys.has('qualidade_resposta_media')).toBe(true);
    expect(keys.has('satisfacao_media')).toBe(true);
    expect(keys.has('qualidade_por_agente')).toBe(true);

    // Sem avaliação no workspace de teste → value null (front omite, não zero enganoso).
    const qual = payload.cards.find((c) => c.key === 'qualidade_resposta_media');
    expect(qual?.value).toBeNull();
    const csat = payload.cards.find((c) => c.key === 'satisfacao_media');
    expect(csat?.value).toBeNull();
  });

  it('métricas Onda B refletem avaliações semeadas (stat + tabelas + drill-down)', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    // Workspace isolado para asserts deterministicos de média/distribuição.
    const [w] = await db
      .insert(schema.workspaces)
      .values({ name: `OndaB ${sfx}`, slug: `ondab-${sfx}` })
      .returning();
    if (!w) throw new Error('ws');
    try {
      const [mem] = await db
        .insert(members)
        .values({
          workspaceId: w.id,
          authUserId: randomUUID(),
          email: `ondab-${sfx}@t.local`,
          role: 'AGENT',
          status: 'active',
        })
        .returning();
      const [ch] = await db
        .insert(channels)
        .values({
          workspaceId: w.id,
          provider: 'meta_whatsapp',
          name: `WA ob ${sfx}`,
          phoneNumberId: `pnid-ob-${sfx}`,
          wabaId: `waba-ob-${sfx}`,
        })
        .returning();
      if (!mem || !ch) throw new Error('seed');
      const [conv] = await db
        .insert(conversations)
        .values({ workspaceId: w.id, channelId: ch.id, remoteId: `rem-ob-${sfx}`, status: 'closed' })
        .returning();
      if (!conv) throw new Error('conv');
      const [evaluation] = await db
        .insert(schema.conversationEvaluations)
        .values({
          workspaceId: w.id,
          conversationId: conv.id,
          primaryMemberId: mem.id,
          handledBy: 'human',
          qualityScore: 90,
          sentimentScore: 50,
          csatLabel: 'promoter',
          judgeModel: 'm',
        })
        .returning();
      if (!evaluation) throw new Error('eval');
      await db.insert(schema.objections).values({
        workspaceId: w.id,
        conversationId: conv.id,
        evaluationId: evaluation.id,
        category: 'price',
        label: 'Achou caro',
        excerpt: 'ta caro',
        resolved: true,
      });

      const payload = await withWorkspace(w.id, (tx) =>
        loadDashboard(tx, { workspaceId: w.id, memberId: mem.id, role: 'ADMIN' }),
      );
      const qual = payload.cards.find((c) => c.key === 'qualidade_resposta_media');
      expect(qual?.value?.['value']).toBe(90);
      expect(qual?.value?.['sample']).toBe(1);

      const csat = payload.cards.find((c) => c.key === 'satisfacao_media');
      expect(csat?.value?.['promoters']).toBe(1);
      expect(csat?.value?.['value']).toBe(50);

      const porAtendente = payload.cards.find((c) => c.key === 'qualidade_por_atendente');
      expect(Array.isArray(porAtendente?.value?.['rows'])).toBe(true);
      expect((porAtendente?.value?.['rows'] as unknown[]).length).toBe(1);

      const obj = payload.cards.find((c) => c.key === 'objecoes_rankeadas');
      const objRows = obj?.value?.['rows'] as { categoria: string; pct_resolvida: number }[];
      expect(objRows[0]?.categoria).toBe('price');
      expect(objRows[0]?.pct_resolvida).toBe(100);

      // Drill-down: exemplos da categoria 'price' (excerpt visível no drawer).
      const drill = await withWorkspace(w.id, (tx) =>
        drillDown(tx, {
          workspaceId: w.id,
          memberId: mem.id,
          role: 'ADMIN',
          metricKey: 'objecoes_rankeadas',
          param: 'price',
        }),
      );
      expect(drill.kind).toBe('ok');
      if (drill.kind === 'ok') {
        const rows = drill.detail['rows'] as { excerpt: string | null }[];
        expect(rows[0]?.excerpt).toBe('ta caro');
      }

      // Categoria inválida no drill-down → unknown_metric (não exfiltra).
      const bad = await withWorkspace(w.id, (tx) =>
        drillDown(tx, {
          workspaceId: w.id,
          memberId: mem.id,
          role: 'ADMIN',
          metricKey: 'objecoes_rankeadas',
          param: 'weather',
        }),
      );
      expect(bad.kind).toBe('unknown_metric');
    } finally {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, w.id));
    }
  });
});

describe('dashboard F48 Command Center v2: leaderboard / feed / timeseries (F48-S03)', () => {
  const NEW_KEYS = ['leaderboard_produtividade', 'leads_recentes', 'desempenho_30d'] as const;

  it('os 3 cards novos são de supervisão+ (SUP_RO) e não vazam pro AGENT (§10)', () => {
    const agent = new Set(visibleMetricKeys('AGENT'));
    const sup = new Set(visibleMetricKeys('SUPERVISOR'));
    const admin = new Set(visibleMetricKeys('ADMIN'));
    const owner = new Set(visibleMetricKeys('OWNER'));
    const readonly = new Set(visibleMetricKeys('READONLY'));

    for (const key of NEW_KEYS) {
      // SUP_RO: SUPERVISOR/ADMIN/OWNER/READONLY veem; AGENT nunca.
      expect(sup.has(key)).toBe(true);
      expect(admin.has(key)).toBe(true);
      expect(owner.has(key)).toBe(true);
      expect(readonly.has(key)).toBe(true);
      expect(agent.has(key)).toBe(false);
    }
  });

  it('cardType/cadence corretos no catálogo', () => {
    const byKey = new Map(metricsForRole('OWNER', true).map((m) => [m.key, m]));
    expect(byKey.get('leaderboard_produtividade')?.cardType).toBe('leaderboard');
    expect(byKey.get('leads_recentes')?.cardType).toBe('feed');
    expect(byKey.get('desempenho_30d')?.cardType).toBe('timeseries');
    expect(byKey.get('leads_recentes')?.cadence).toBe('socket');
    expect(byKey.get('desempenho_30d')?.cadence).toBe('mv_1d');
  });

  it('loadDashboard entrega os 3 cards ao SUPERVISOR e nenhum ao AGENT', async () => {
    const sup = await withWorkspace(ws, (tx) =>
      loadDashboard(tx, { workspaceId: ws, memberId, role: 'SUPERVISOR' }),
    );
    const supKeys = new Set(sup.cards.map((c) => c.key));
    for (const key of NEW_KEYS) expect(supKeys.has(key)).toBe(true);

    const agent = await withWorkspace(ws, (tx) =>
      loadDashboard(tx, { workspaceId: ws, memberId, role: 'AGENT' }),
    );
    const agentKeys = new Set(agent.cards.map((c) => c.key));
    for (const key of NEW_KEYS) expect(agentKeys.has(key)).toBe(false);

    // Shapes do S02: leaderboard/feed → { rows }, série → { series }.
    const leaderboard = sup.cards.find((c) => c.key === 'leaderboard_produtividade');
    expect(Array.isArray(leaderboard?.value?.['rows'])).toBe(true);
    const leads = sup.cards.find((c) => c.key === 'leads_recentes');
    expect(Array.isArray(leads?.value?.['rows'])).toBe(true);
    const serie = sup.cards.find((c) => c.key === 'desempenho_30d');
    expect(Array.isArray(serie?.value?.['series'])).toBe(true);

    // Feed de leads aponta o drill-down para /contacts.
    expect(leads?.drillHref).toBe('/contacts');
  });
});
