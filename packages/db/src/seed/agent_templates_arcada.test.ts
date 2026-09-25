/**
 * F70-S06 — agente de atendimento da Arcada.
 *
 * 1) Conteúdo (puro): os limites de negociação aprovados em 24/09 estão travados,
 *    os 4 gatilhos de handoff estão no prompt, e nenhum número fora dos limites
 *    (percentual, parcelas, valor em R$) aparece no prompt ou na KB.
 * 2) Grafos dos flows: 1 trigger, tudo alcançável, sem ciclo (regras do publish),
 *    handles válidos por tipo de node.
 * 3) Integração (Postgres dev): o seed roda sob RLS, não ativa nada e é idempotente.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../client';
import { withWorkspace } from '../rls';
import {
  agentPromptVersions,
  agentTemplates,
  agentTools,
  agents,
  flowVersions,
  flows,
  kbChunks,
  kbDocuments,
  tags,
  workspaces,
} from '../schema';
import {
  ARCADA_HANDOFF_TRIGGERS,
  ARCADA_MODEL,
  ARCADA_NEGOTIATION_LIMITS,
  ARCADA_TAGS,
  ARCADA_TIERS,
  allowedAmountsCents,
  buildArcadaKbDocuments,
  buildArcadaSystemPrompt,
  installmentsCents,
  listPendingMarkers,
} from './agent_templates_arcada.content';
import {
  arcadaIds,
  buildActivationFlowGraph,
  buildCadenceFlowGraph,
  defaultArcadaSeedContent,
  seedArcadaAttendance,
  type SeedFlowGraph,
} from './agent_templates_arcada';
import { seedLlmModels } from './llm_models';

const prompt = buildArcadaSystemPrompt();
const kbTexts = buildArcadaKbDocuments().map((d) => d.rawContent);

/** `R$ 1.234,56` → centavos. */
function parseBrl(raw: string): number {
  const [reais = '0', cents = '0'] = raw.replace(/\./g, '').split(',');
  return Number(reais) * 100 + Number(cents.padEnd(2, '0'));
}

describe('Arcada — limites de negociação', () => {
  it('limites aprovados em 24/09 estão travados', () => {
    expect(ARCADA_NEGOTIATION_LIMITS).toEqual({
      defaultInstallments: 2,
      maxInstallments: 3,
      installmentsDiscountPct: 0,
      cashDiscountPct: 10,
      maxCashDiscountPct: 15,
      deliveryBusinessDays: 5,
    });
    expect(ARCADA_TIERS.map((t) => t.priceBrl)).toEqual([1000, 2500, 5000]);
    expect(ARCADA_MODEL).toBe('anthropic/claude-sonnet-4');
  });

  it('o prompt declara cada limite', () => {
    for (const s of [
      'R$ 1.000',
      'R$ 2.500',
      'R$ 5.000',
      'ofereça em até 2x sem juros',
      'pode chegar a 3x sem juros',
      'Nunca parcele em mais de 3 vezes',
      'No parcelado não existe desconto',
      '10% de desconto em qualquer nível',
      'pode chegar a 15%, uma única vez, e esse é o teto absoluto',
      'Desconto e parcelamento nunca se combinam',
      'até 5 dias úteis',
      'Não prometa prazo menor',
      'Costuma ficar pronto antes',
    ]) {
      expect(prompt).toContain(s);
    }
  });

  it('nenhum percentual, parcelamento ou valor fora dos limites aparece (prompt e KB)', () => {
    const allowed = allowedAmountsCents();
    for (const text of [prompt, ...kbTexts]) {
      for (const [, pct] of text.matchAll(/(\d+)\s*%/g)) {
        expect([10, 15]).toContain(Number(pct));
      }
      for (const [, n] of text.matchAll(/\b(\d+)x\b/g)) {
        expect([2, 3]).toContain(Number(n));
      }
      for (const [, brl] of text.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)) {
        expect(allowed.has(parseBrl(brl ?? ''))).toBe(true);
      }
    }
  });

  it('valores de referência corretos (à vista e parcelas somam o preço)', () => {
    expect(prompt).toContain('R$ 1.000: à vista com 10% = R$ 900; teto com 15% = R$ 850');
    expect(prompt).toContain('R$ 2.500: à vista com 10% = R$ 2.250; teto com 15% = R$ 2.125');
    expect(prompt).toContain('R$ 5.000: à vista com 10% = R$ 4.500; teto com 15% = R$ 4.250');
    expect(prompt).toContain('3x (R$ 333,33 + R$ 333,33 + R$ 333,34)');
    for (const t of ARCADA_TIERS) {
      for (const n of [2, 3]) {
        const parts = installmentsCents(t.priceBrl, n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(t.priceBrl * 100);
      }
    }
  });
});

describe('Arcada — handoff para humano', () => {
  it('os 4 gatilhos existem e estão no prompt ligados ao transfer_to_human', () => {
    expect(ARCADA_HANDOFF_TRIGGERS.map((t) => t.id)).toEqual([
      'ready_to_close',
      'asked_for_human',
      'irritation',
      'out_of_limits',
    ]);
    const section = prompt.slice(prompt.indexOf('## Quando passar para o Rogério'));
    expect(section).toContain('transfer_to_human');
    for (const t of ARCADA_HANDOFF_TRIGGERS) {
      expect(section).toContain(`[${t.id}]`);
      expect(section).toContain(t.title);
    }
    expect(section).toContain('Depois de transferir, não responda mais');
    expect(section).toContain(ARCADA_TAGS.humanTakeover.name);
  });

  it('qualificação, portfólio e agendamento estão no prompt', () => {
    for (const s of [
      'É uma clínica?',
      'Já tem site hoje?',
      'É quem decide?',
      'Para quando precisa do site?',
      '{{links_do_portfolio}}',
      '{{como_agendar}}',
    ]) {
      expect(prompt).toContain(s);
    }
  });

  it('marcadores pendentes são exatamente os conhecidos (nada inventado no lugar)', () => {
    expect(listPendingMarkers().sort()).toEqual(
      [
        'nivel_1000_inclui',
        'nivel_2500_inclui',
        'nivel_5000_inclui',
        'inicio_do_prazo',
        'links_do_portfolio',
        'casos_autorizados',
        'como_agendar',
        'meios_de_pagamento',
        'material_necessario',
        'dominio_e_hospedagem',
        'alteracoes_e_manutencao',
        'google_e_seo',
        'contrato_e_nota_fiscal',
        'modelo_lembrete_dia_3',
        'modelo_lembrete_dia_7',
        'modelo_toque_30_dias',
      ].sort(),
    );
    expect(prompt).toContain('Nunca mostre esses trechos ao cliente');
  });
});

// ─── Grafos: as mesmas regras do validateFlow do publish (@hm/flow-engine).

const HANDLES: Readonly<Record<string, readonly string[]>> = {
  condition: ['true', 'false'],
  wait_for_response: ['response', 'timeout'],
};
const KNOWN_TYPES = new Set([
  'trigger',
  'condition',
  'ai_action',
  'add_tag',
  'remove_tag',
  'message',
  'template',
  'wait_for_response',
]);

function assertPublishable(graph: SeedFlowGraph): void {
  const ids = new Set(graph.nodes.map((n) => n.id));
  expect(ids.size).toBe(graph.nodes.length);
  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  expect(triggers).toHaveLength(1);
  for (const n of graph.nodes) expect(KNOWN_TYPES.has(n.type)).toBe(true);

  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
    const source = graph.nodes.find((n) => n.id === e.source);
    const allowed = source ? HANDLES[source.type] : undefined;
    if (allowed) expect(allowed).toContain(e.sourceHandle);
    else expect(e.sourceHandle).toBeUndefined();
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  }

  // Alcançabilidade a partir do trigger.
  const start = triggers[0]?.id ?? '';
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift() ?? '';
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  expect([...ids].filter((id) => !seen.has(id))).toEqual([]);

  // Sem ciclo (DFS 3 cores).
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1 || (c === 0 && visit(next))) return true;
    }
    color.set(id, 2);
    return false;
  };
  expect([...ids].some((id) => (color.get(id) ?? 0) === 0 && visit(id))).toBe(false);
}

const FAKE_TAGS = {
  aiActivated: randomUUID(),
  humanTakeover: randomUUID(),
  cooledDown: randomUUID(),
};

describe('Arcada — flows', () => {
  it('ativação: publicável, ACTIVATE só quando a IA não foi decidida, ramo bloqueado sem efeito', () => {
    const agentId = randomUUID();
    const g = buildActivationFlowGraph(agentId, FAKE_TAGS);
    assertPublishable(g);
    const activate = g.nodes.find((n) => n.type === 'ai_action');
    expect(activate?.data).toMatchObject({ action: 'ACTIVATE', agentId });
    // ACTIVATE só no ramo `false` de "já decidida".
    expect(g.edges).toContainEqual(
      expect.objectContaining({
        source: 'already_decided',
        target: 'activate',
        sourceHandle: 'false',
      }),
    );
    // Recusa da trava: nenhuma aresta sai do ramo `true` (nada visível ao contato).
    const blocked = g.nodes.find((n) => n.id === 'blocked');
    expect(blocked?.data).toMatchObject({
      operator: 'HAS_VALUE',
      variable: 'ai_activation_blocked',
    });
    expect(g.edges.filter((e) => e.source === 'blocked' && e.sourceHandle === 'true')).toEqual([]);
    // Nenhum node de envio no flow de ativação.
    expect(g.nodes.some((n) => n.type === 'message' || n.type === 'template')).toBe(false);
  });

  it('cadência: publicável, 24h livre, 3º/7º/30 com modelo, esfriou, gate de humano antes de cada envio', () => {
    const g = buildCadenceFlowGraph(FAKE_TAGS);
    assertPublishable(g);
    const waits = g.nodes
      .filter((n) => n.type === 'wait_for_response')
      .map((n) => n.data['timeoutMinutes']);
    // Relógio cumulativo desde a última mensagem do cliente: 20h, 3º dia, 7º dia, +30 dias.
    expect(waits).toEqual([20 * 60, 3 * 24 * 60 - 20 * 60, 4 * 24 * 60, 30 * 24 * 60]);
    expect(g.nodes.filter((n) => n.type === 'template')).toHaveLength(3);
    expect(g.nodes.filter((n) => n.type === 'message')).toHaveLength(1);
    for (const send of g.nodes.filter((n) => n.type === 'message' || n.type === 'template')) {
      const incoming = g.edges.filter((e) => e.target === send.id);
      expect(incoming).toHaveLength(1);
      const gate = g.nodes.find((n) => n.id === incoming[0]?.source);
      expect(gate?.data).toMatchObject({ operator: 'HAS_TAG', tagId: FAKE_TAGS.humanTakeover });
      expect(incoming[0]?.sourceHandle).toBe('false');
    }
    expect(g.nodes).toContainEqual(
      expect.objectContaining({
        type: 'add_tag',
        data: expect.objectContaining({ tagId: FAKE_TAGS.cooledDown }),
      }),
    );
    // Toda resposta do cliente termina a execução tirando `esfriou`.
    for (const w of g.nodes.filter((n) => n.type === 'wait_for_response')) {
      expect(g.edges).toContainEqual(
        expect.objectContaining({ source: w.id, target: 'clear_cooled', sourceHandle: 'response' }),
      );
    }
  });
});

// ─── Integração (Postgres dev).

describe('Arcada — seed no banco (dev)', () => {
  const sfx = randomUUID().slice(0, 8);
  let ws = '';

  beforeAll(async () => {
    const db = getDb();
    await seedLlmModels(db); // catálogo global idempotente (pré-requisito do seed)
    const [w] = await db
      .insert(workspaces)
      .values({ name: `Arcada ${sfx}`, slug: `arcada-${sfx}` })
      .returning({ id: workspaces.id });
    if (!w) throw new Error('Falha ao criar workspace de teste.');
    ws = w.id;
  });

  afterAll(async () => {
    if (ws) await getDb().delete(workspaces).where(eq(workspaces.id, ws));
    await closeDb();
  });

  async function counts() {
    const db = getDb();
    const ids = arcadaIds(ws);
    const [tpl, ag, ver, fl, fv, tg, kb, ch, at] = await Promise.all([
      db.select().from(agentTemplates).where(eq(agentTemplates.workspaceId, ws)),
      db.select().from(agents).where(eq(agents.workspaceId, ws)),
      db.select().from(agentPromptVersions).where(eq(agentPromptVersions.workspaceId, ws)),
      db.select().from(flows).where(eq(flows.workspaceId, ws)),
      db.select().from(flowVersions).where(eq(flowVersions.flowId, ids.activationFlowId)),
      db.select().from(tags).where(eq(tags.workspaceId, ws)),
      db.select().from(kbDocuments).where(eq(kbDocuments.workspaceId, ws)),
      db.select().from(kbChunks).where(eq(kbChunks.workspaceId, ws)),
      db.select().from(agentTools).where(eq(agentTools.agentId, ids.agentId)),
    ]);
    return { tpl, ag, ver, fl, fv, tg, kb, ch, at };
  }

  it('roda sob RLS, não ativa nada e é idempotente (2x não duplica)', async () => {
    const first = await withWorkspace(ws, (tx) => seedArcadaAttendance(tx, ws));
    expect(first.created).toEqual(
      expect.arrayContaining([
        'agent',
        'prompt_version:1',
        'flow:activation',
        'flow:cadence',
        'kb:faq',
      ]),
    );
    const a = await counts();

    // Template do WORKSPACE (nunca global: carrega preços do Rogério).
    expect(a.tpl).toHaveLength(1);
    expect(a.tpl[0]).toMatchObject({
      isGlobal: false,
      key: 'arcada_attendance',
      defaultModel: ARCADA_MODEL,
    });

    // Agente inativo, Sonnet, com v1 live idêntica ao live do agente.
    expect(a.ag).toHaveLength(1);
    expect(a.ag[0]).toMatchObject({
      status: 'inactive',
      model: ARCADA_MODEL,
      name: 'Arcada — atendimento',
    });
    expect(a.ver).toHaveLength(1);
    expect(a.ver[0]).toMatchObject({
      version: 1,
      status: 'live',
      systemPrompt: a.ag[0]?.systemPrompt,
    });

    // Flows em rascunho, sem version publicada (o dispatcher só lê `active`).
    expect(a.fl).toHaveLength(2);
    expect(a.fl.every((f) => f.status === 'draft' && f.triggerType === 'new_message')).toBe(true);
    expect(a.fv).toHaveLength(0);
    const activation = a.fl.find((f) => f.id === first.flowIds.activation);
    expect(JSON.stringify(activation?.nodes)).toContain(first.agentId);
    expect(JSON.stringify(activation?.nodes)).toContain(first.tagIds.aiActivated);

    // Tags e KB (rascunho, invisível, sem chunks).
    expect(a.tg.map((t) => t.name).sort()).toEqual(['atendimento-humano', 'esfriou', 'ia-arcada']);
    expect(a.kb).toHaveLength(3);
    expect(a.kb.every((d) => d.status === 'draft' && !d.visibleToAgents)).toBe(true);
    expect(a.ch).toHaveLength(0);

    // 2ª rodada: nada criado, contagens idênticas.
    const second = await withWorkspace(ws, (tx) => seedArcadaAttendance(tx, ws));
    expect(second.created).toEqual([]);
    expect(second.draftPromptVersion).toBeNull();
    const b = await counts();
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      expect(b[k]).toHaveLength(a[k].length);
    }
    expect(second.agentId).toBe(first.agentId);
  });

  it('prompt novo no seed vira RASCUNHO; o live e o agente não mudam', async () => {
    const base = defaultArcadaSeedContent();
    const changed = { ...base, systemPrompt: `${base.systemPrompt}\n- Ajuste de teste.` };
    const report = await withWorkspace(ws, (tx) => seedArcadaAttendance(tx, ws, changed));
    expect(report.draftPromptVersion).toBe(2);

    const db = getDb();
    const versions = await db
      .select()
      .from(agentPromptVersions)
      .where(eq(agentPromptVersions.agentId, report.agentId));
    expect(versions.map((v) => `${v.version}:${v.status}`).sort()).toEqual(['1:live', '2:draft']);
    const [agent] = await db.select().from(agents).where(eq(agents.id, report.agentId));
    expect(agent?.systemPrompt).toBe(base.systemPrompt);
    expect(agent?.status).toBe('inactive');

    // Reaplicar o mesmo conteúdo novo não cria v3.
    const again = await withWorkspace(ws, (tx) => seedArcadaAttendance(tx, ws, changed));
    expect(again.draftPromptVersion).toBeNull();
  });
});
