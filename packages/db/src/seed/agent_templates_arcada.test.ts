/**
 * F70-S06 — agente de atendimento da Arcada (preço de lançamento: F70-S33).
 *
 * 1) Conteúdo (puro): preço de lançamento, pagamento por nível e prazo de 29/09 estão
 *    travados; nenhuma oferta de desconto, urgência ou escassez aparece no prompt ou na
 *    KB; os 4 gatilhos de handoff estão no prompt; nenhum valor fora da tabela aparece.
 * 2) Grafos dos flows: 1 trigger, tudo alcançável, sem ciclo (regras do publish),
 *    handles válidos por tipo de node.
 * 3) Integração (Postgres dev): o seed roda sob RLS, não ativa nada e é idempotente.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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
  tools,
  workspaces,
} from '../schema';
import {
  ARCADA_CADENCE,
  ARCADA_DELIVERY_COMMITMENT,
  ARCADA_HANDOFF_TRIGGERS,
  ARCADA_LAUNCH_PRICE_PHRASE,
  ARCADA_MODEL,
  ARCADA_NEGOTIATION_LIMITS,
  ARCADA_NO_DISCOUNT,
  ARCADA_NO_PRESSURE_RULE,
  ARCADA_PREFILLED_FOR_APPROVAL,
  ARCADA_SITE_URL,
  ARCADA_TAGS,
  ARCADA_TIER_INCLUDES,
  ARCADA_TIERS,
  allowedAmountsCents,
  buildArcadaKbDocuments,
  buildArcadaSystemPrompt,
  describeInstallments,
  installmentsCents,
  listPendingMarkers,
  tierIncludesText,
} from './agent_templates_arcada.content';
import {
  arcadaIds,
  buildActivationFlowGraph,
  buildCadenceFlowGraph,
  defaultArcadaSeedContent,
  fillLegacyTemplateNames,
  seedArcadaAttendance,
  type SeedFlowGraph,
} from './agent_templates_arcada';
import { seedLlmModels } from './llm_models';

const prompt = buildArcadaSystemPrompt();
const kbTexts = buildArcadaKbDocuments().map((d) => d.rawContent);
const allTexts = [prompt, ...kbTexts];
const kbLevels = kbTexts[0] ?? '';
const kbFaq = kbTexts[1] ?? '';

/** `R$ 1.234,56` → centavos. */
function parseBrl(raw: string): number {
  const [reais = '0', cents = '0'] = raw.replace(/\./g, '').split(',');
  return Number(reais) * 100 + Number(cents.padEnd(2, '0'));
}

/** Remove as ocorrências exatas de um trecho autorizado antes de varrer o texto. */
function without(text: string, allowedSnippet: string): string {
  return text.split(allowedSnippet).join(' ');
}

const NO_DISCOUNT_RE = new RegExp(ARCADA_NO_DISCOUNT, 'gi');

/**
 * Detector de oferta de desconto. A única menção permitida é a negação exata
 * (`não tem desconto`): toda ocorrência de "descont…" precisa ser ela. Fora disso,
 * nenhum percentual, abatimento, cupom, "de R$ x por R$ y" nem valor fora da tabela.
 */
function discountOffers(text: string): string[] {
  const found: string[] = [];
  const mentions = (text.match(/descont/gi) ?? []).length;
  const negations = (text.match(NO_DISCOUNT_RE) ?? []).length;
  if (mentions !== negations) found.push(`"desconto" fora da negação (${mentions}/${negations})`);
  const rest = without(text, ARCADA_NO_DISCOUNT);
  for (const re of [
    /\d+(?:,\d+)?\s*%/,
    /por cento/i,
    /abatimento|cupom|\boff\b|mais barat|preço especial|de R\$[^\n]*por R\$/i,
  ]) {
    const hit = rest.match(re);
    if (hit) found.push(hit[0]);
  }
  const allowed = allowedAmountsCents();
  for (const [raw, brl] of rest.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)) {
    if (!allowed.has(parseBrl(brl ?? ''))) found.push(raw);
  }
  return found;
}

const PRESSURE_RE =
  /urg[êe]n|escass|\bvagas?\b|só hoje|somente hoje|tempo limitado|\bcorra\b|aproveite|promo[çc]|\bacaba|termina em|última chance|últimos dias|v[aá]lid[oa] até|até o fim|até o dia|(esta|essa) semana|(este|esse) mês|\brestam\b|poucas unidades|limitad/i;

describe('Arcada — preço de lançamento e pagamento (29/09)', () => {
  it('níveis: nome, preço de lançamento e parcelas máximas por nível', () => {
    expect(
      ARCADA_TIERS.map((t) => ({
        key: t.key,
        name: t.name,
        priceBrl: t.priceBrl,
        maxInstallments: t.maxInstallments,
      })),
    ).toEqual([
      { key: 'essencial', name: 'Essencial', priceBrl: 297, maxInstallments: 1 },
      { key: 'estudio', name: 'Estúdio', priceBrl: 397, maxInstallments: 1 },
      { key: 'cinema', name: 'Cinema', priceBrl: 999, maxInstallments: 2 },
    ]);
    expect(ARCADA_NEGOTIATION_LIMITS).toEqual({ discountAllowed: false, deliveryBusinessDays: 5 });
    expect(ARCADA_MODEL).toBe('anthropic/claude-sonnet-5');
  });

  it('prompt e KB declaram preço e pagamento de cada nível (Cinema 2 × R$ 499,50)', () => {
    for (const s of [
      '- Essencial, R$ 297: só à vista.',
      '- Estúdio, R$ 397: só à vista.',
      '- Cinema, R$ 999: à vista ou em 2 parcelas iguais (2 × R$ 499,50), nunca mais que 2.',
    ]) {
      expect(prompt).toContain(s);
      expect(kbLevels).toContain(s);
    }
    expect(installmentsCents(999, 2)).toEqual([49950, 49950]);
    expect(describeInstallments(999, 2)).toBe('2 × R$ 499,50');
  });

  it('parcelamento só no Cinema: toda linha com parcelas ou R$ 499,50 fala do Cinema', () => {
    for (const text of allTexts) {
      for (const line of text.split('\n')) {
        if (/\d\s*[x×]\s*R\$|R\$\s*499,50|parcela/i.test(line)) {
          expect(line, line).toContain('Cinema');
        }
      }
      for (const [, n] of text.matchAll(/\b(\d+)\s*[x×](?=\s)/g)) expect(Number(n)).toBe(2);
      expect(text).not.toMatch(/\b\d+\s*vezes|sem juros|juros/i);
    }
    // Essencial e Estúdio: sem parcelamento em lugar nenhum da seção deles na KB.
    for (const name of ['Essencial', 'Estúdio']) {
      const section = kbLevels.split('\n## ').find((s) => s.startsWith(`${name}:`)) ?? '';
      expect(section, name).toContain(`Pagamento do ${name}: só à vista.`);
      expect(section, name).not.toMatch(/parcela|×|R\$\s*499,50/);
    }
  });

  it('nenhum valor fora da tabela aparece (nem os preços antigos)', () => {
    const allowed = allowedAmountsCents();
    expect([...allowed].sort((a, b) => a - b)).toEqual([29700, 39700, 49950, 99900]);
    for (const text of allTexts) {
      for (const [, brl] of text.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)) {
        expect(allowed.has(parseBrl(brl ?? '')), `R$ ${brl}`).toBe(true);
      }
      expect(text).not.toMatch(/1\.000|2\.500|5\.000|\b1000\b|\b2500\b|\b5000\b/);
    }
  });

  it('nenhuma oferta de desconto no prompt nem na KB; a única menção é "não tem desconto"', () => {
    for (const text of allTexts) expect(discountOffers(text)).toEqual([]);
    expect(prompt).toContain(
      `explique, sem pressão, que é o ${ARCADA_LAUNCH_PRICE_PHRASE}, e que ${ARCADA_NO_DISCOUNT}.`,
    );
    expect(prompt).toContain(
      `com preço fechado: ${ARCADA_NO_DISCOUNT}, nem à vista, nem negociando`,
    );
    expect(kbLevels).toContain(`Preço fechado: ${ARCADA_NO_DISCOUNT}`);
    expect(kbFaq).toContain(`O preço é fechado e ${ARCADA_NO_DISCOUNT}.`);
  });

  it('o detector de desconto pega oferta real e aceita a negação (controle)', () => {
    for (const bad of [
      'À vista com 10% de desconto.',
      'Consigo um desconto para você.',
      'Tem desconto no Pix.',
      'Fica R$ 250 à vista.',
      'De R$ 1.000 por R$ 297.',
      'Faço 5 por cento a menos.',
      `Normalmente ${ARCADA_NO_DISCOUNT}, mas hoje dou desconto.`,
    ]) {
      expect(discountOffers(bad).length, bad).toBeGreaterThan(0);
    }
    expect(discountOffers(`O preço é fechado e ${ARCADA_NO_DISCOUNT}.`)).toEqual([]);
  });

  it('tom: valor de lançamento, sem urgência, escassez ou prazo para a condição', () => {
    expect(ARCADA_LAUNCH_PRICE_PHRASE).toBe(
      'valor de lançamento, enquanto a Arcada monta os primeiros casos',
    );
    // Onde há preço (prompt, níveis, FAQ), ele vem com o posicionamento de lançamento.
    for (const text of [prompt, kbLevels, kbFaq])
      expect(text).toContain(ARCADA_LAUNCH_PRICE_PHRASE);
    // A regra anti-pressão (único trecho que cita os exemplos proibidos) está no prompt.
    expect(prompt).toContain(ARCADA_NO_PRESSURE_RULE);
    for (const text of allTexts) {
      const rest = without(text, ARCADA_NO_PRESSURE_RULE);
      expect(rest.match(PRESSURE_RE)?.[0] ?? null).toBeNull();
      expect(rest).not.toMatch(/\b\d{1,2}\/\d{1,2}\b/); // nenhuma data
    }
    // Controle: o detector pega pressão real.
    for (const bad of ['Últimas vagas!', 'Só hoje.', 'A promoção vale até sexta.', 'Restam 2.']) {
      expect(bad).toMatch(PRESSURE_RE);
    }
  });

  it('prazo: até 5 dias úteis a partir do material completo com CRO, em todos os níveis', () => {
    const commitment =
      'até 5 dias úteis, contados a partir do recebimento do material completo, com o CRO do responsável técnico';
    expect(ARCADA_DELIVERY_COMMITMENT).toBe(commitment);
    expect(prompt).toContain(`Prazo, em todos os níveis: entrega final em ${commitment}.`);
    expect(prompt).toContain(`- Prazo: ${commitment}. Nunca prometa prazo menor.`);
    for (const t of ARCADA_TIERS) {
      const section = kbLevels.split('\n## ').find((s) => s.startsWith(`${t.name}:`)) ?? '';
      expect(section, t.name).toContain(`Prazo do ${t.name}: entrega final em ${commitment}.`);
    }
    expect(kbFaq).toContain(commitment);
    for (const text of allTexts) {
      for (const [, n] of text.matchAll(/(\d+)\s*dias úteis/g)) expect(Number(n)).toBe(5);
      expect(text).not.toMatch(
        /pronto antes|costuma ficar|normalmente fica|mais rápido|antes do prazo/i,
      );
    }
  });

  it('o que cada nível inclui veio das fontes; demos sempre como projeto conceito', () => {
    expect(ARCADA_TIER_INCLUDES.essencial.items[0]).toBe(
      '1 página longa, mais política de privacidade e página 404',
    );
    expect(ARCADA_TIER_INCLUDES.estudio.items[0]).toBe('10 a 16 páginas');
    expect(ARCADA_TIER_INCLUDES.cinema.items).toEqual([
      'tudo do Estúdio',
      'mais a camada de movimento: cena de scroll gerada, vídeo no topo e movimento dirigido',
    ]);
    for (const t of ARCADA_TIERS) {
      expect(prompt).toContain(`- ${t.name}, R$ ${t.priceBrl}: ${tierIncludesText(t)}`);
      for (const item of ARCADA_TIER_INCLUDES[t.key].items) expect(kbLevels).toContain(`- ${item}`);
    }
    expect(ARCADA_TIERS.map((t) => [t.name, t.demo])).toEqual([
      ['Essencial', 'Aline Tenório Odontologia'],
      ['Estúdio', 'Quadrante Odontologia'],
      ['Cinema', 'Nácar Odontologia'],
    ]);
    for (const text of allTexts) {
      for (const line of text.split('\n')) {
        if (/Aline Tenório|Quadrante|Nácar/.test(line)) {
          expect(line, line).toMatch(/projeto conceito/i);
          expect(line, line).toContain('não é cliente');
        }
      }
    }
    expect(ARCADA_SITE_URL).toBe('https://arcada-sandy.vercel.app');
    expect(prompt).toContain(ARCADA_SITE_URL);
    expect(prompt).toContain('nunca os apresente como cliente ou caso real');
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
      ARCADA_SITE_URL,
      '{{links_das_demos}}',
      '{{como_agendar}}',
    ]) {
      expect(prompt).toContain(s);
    }
  });

  it('marcadores: os de nome novo estão pré-preenchidos; pendentes são só os sem fonte', () => {
    expect(ARCADA_TIERS.map((t) => t.includesMarker)).toEqual([
      'nivel_essencial_inclui',
      'nivel_estudio_inclui',
      'nivel_cinema_inclui',
    ]);
    expect(Object.keys(ARCADA_PREFILLED_FOR_APPROVAL).sort()).toEqual(
      [
        'nivel_essencial_inclui',
        'nivel_estudio_inclui',
        'nivel_cinema_inclui',
        'inicio_do_prazo',
        'links_do_portfolio',
        'modelo_lembrete_dia_3',
        'modelo_lembrete_dia_7',
        'modelo_toque_30_dias',
      ].sort(),
    );
    expect(listPendingMarkers().sort()).toEqual(
      [
        'links_das_demos',
        'casos_autorizados',
        'como_agendar',
        'meios_de_pagamento',
        'material_necessario',
        'dominio_e_hospedagem',
        'alteracoes_e_manutencao',
        'google_e_seo',
        'contrato_e_nota_fiscal',
      ].sort(),
    );
    // Nenhum marcador antigo nem pré-preenchido sobrou no texto.
    for (const text of allTexts) {
      expect(text).not.toMatch(/nivel_(1000|2500|5000)_inclui/);
      for (const key of Object.keys(ARCADA_PREFILLED_FOR_APPROVAL)) {
        expect(text).not.toContain(`{{${key}}}`);
      }
    }
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
    const templates = g.nodes.filter((n) => n.type === 'template');
    // Modelos definidos pelo Rogério (29/09), enviados sem parâmetros.
    expect(templates.map((n) => n.data['templateName'])).toEqual([
      'arcada_lembrete_dia_3',
      'arcada_lembrete_dia_7',
      'arcada_toque_30_dias',
    ]);
    for (const t of templates) {
      expect(t.data['languageCode']).toBe(ARCADA_CADENCE.templateLanguage);
      expect(t.data).not.toHaveProperty('params');
    }
    expect(JSON.stringify(g)).not.toContain('{{');
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

/** Cadência como a versão anterior do seed gravava: `templateName` = marcador. */
function legacyCadenceNodes(tagIds: Parameters<typeof buildCadenceFlowGraph>[0]): unknown[] {
  const legacy: Readonly<Record<string, string>> = {
    arcada_lembrete_dia_3: '{{modelo_lembrete_dia_3}}',
    arcada_lembrete_dia_7: '{{modelo_lembrete_dia_7}}',
    arcada_toque_30_dias: '{{modelo_toque_30_dias}}',
  };
  return buildCadenceFlowGraph(tagIds).nodes.map((n) => {
    const name = n.data['templateName'];
    return n.type === 'template' && typeof name === 'string'
      ? { ...n, data: { ...n.data, templateName: legacy[name] } }
      : n;
  });
}

describe('Arcada — nomes dos modelos na cadência já existente', () => {
  it('troca só o marcador antigo; nome editado pelo operador fica', () => {
    const legacy = legacyCadenceNodes(FAKE_TAGS);
    const { nodes, changed } = fillLegacyTemplateNames(legacy);
    expect(changed).toBe(3);
    expect(nodes).toEqual(buildCadenceFlowGraph(FAKE_TAGS).nodes);

    const edited = legacy.map((n, i) =>
      i === legacy.findIndex((x) => JSON.stringify(x).includes('modelo_lembrete_dia_3'))
        ? { ...(n as object), data: { templateName: 'modelo_do_operador', languageCode: 'pt_BR' } }
        : n,
    );
    const second = fillLegacyTemplateNames(edited);
    expect(second.changed).toBe(2);
    expect(JSON.stringify(second.nodes)).toContain('modelo_do_operador');
    // Idempotente: rodar de novo não muda nada.
    expect(fillLegacyTemplateNames(nodes).changed).toBe(0);
    // Entrada estranha é ignorada, sem lançar.
    expect(fillLegacyTemplateNames([null, 1, { type: 'template' }]).changed).toBe(0);
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

  it('libera só atendimento-humano em add_contact_tag e não sobrescreve a edição do operador (F70-S23)', async () => {
    const report = await withWorkspace(ws, (tx) => seedArcadaAttendance(tx, ws));
    const db = getDb();
    const links = await db
      .select({ toolId: agentTools.toolId, overrides: agentTools.overrides, key: tools.key })
      .from(agentTools)
      .innerJoin(tools, eq(tools.id, agentTools.toolId))
      .where(eq(agentTools.agentId, report.agentId));
    const tagLink = links.find((l) => l.key === 'add_contact_tag');
    // Sem a tool no catálogo do banco de teste, não há o que conferir.
    if (!tagLink) return;
    expect(tagLink.overrides).toEqual({ allowed_tags: ['atendimento-humano'] });

    // O operador ajusta pela UI; uma nova rodada do seed não desfaz.
    const edited = { allowed_tags: ['atendimento-humano', 'vip'] };
    await db
      .update(agentTools)
      .set({ overrides: edited })
      .where(and(eq(agentTools.agentId, report.agentId), eq(agentTools.toolId, tagLink.toolId)));
    await withWorkspace(ws, (tx) => seedArcadaAttendance(tx, ws));
    const [after] = await db
      .select({ overrides: agentTools.overrides })
      .from(agentTools)
      .where(and(eq(agentTools.agentId, report.agentId), eq(agentTools.toolId, tagLink.toolId)));
    expect(after?.overrides).toEqual(edited);
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

  it('troca de modelo (Sonnet 4 → Sonnet 5, F70-S31) vira RASCUNHO; o live e o agente não mudam', async () => {
    const db = getDb();
    const [w] = await db
      .insert(workspaces)
      .values({ name: `Arcada S31 ${sfx}`, slug: `arcada-s31-${sfx}` })
      .returning({ id: workspaces.id });
    if (!w) throw new Error('Falha ao criar workspace de teste.');
    const ws31 = w.id;
    try {
      // Estado da produção antes da S31: agente semeado com o Sonnet 4.
      const base = defaultArcadaSeedContent();
      const legacy = { ...base, model: 'anthropic/claude-sonnet-4' };
      await withWorkspace(ws31, (tx) => seedArcadaAttendance(tx, ws31, legacy));

      // Seed atual (Sonnet 5, prompt igual): só o modelo muda.
      const report = await withWorkspace(ws31, (tx) => seedArcadaAttendance(tx, ws31));
      expect(report.draftPromptVersion).toBe(2);
      expect(report.warnings.some((m) => m.includes('anthropic/claude-sonnet-5'))).toBe(false);

      const versions = await db
        .select()
        .from(agentPromptVersions)
        .where(eq(agentPromptVersions.agentId, report.agentId));
      const byVersion = new Map(versions.map((v) => [v.version, v]));
      expect(byVersion.get(1)).toMatchObject({
        status: 'live',
        model: 'anthropic/claude-sonnet-4',
      });
      expect(byVersion.get(2)).toMatchObject({
        status: 'draft',
        model: 'anthropic/claude-sonnet-5',
        systemPrompt: base.systemPrompt,
      });
      expect(byVersion.get(2)?.note).toContain('anthropic/claude-sonnet-5');

      const [agent] = await db.select().from(agents).where(eq(agents.id, report.agentId));
      expect(agent).toMatchObject({ model: 'anthropic/claude-sonnet-4', status: 'inactive' });

      // Idempotente: a 2ª rodada com o Sonnet 5 não cria v3.
      const again = await withWorkspace(ws31, (tx) => seedArcadaAttendance(tx, ws31));
      expect(again.draftPromptVersion).toBeNull();
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, ws31));
    }
  });

  it('preço de lançamento (F70-S33) sobre o seed anterior: v2 rascunho, KB em rascunho atualizada, live intocado', async () => {
    const db = getDb();
    const [w] = await db
      .insert(workspaces)
      .values({ name: `Arcada S33 ${sfx}`, slug: `arcada-s33-${sfx}` })
      .returning({ id: workspaces.id });
    if (!w) throw new Error('Falha ao criar workspace de teste.');
    const ws33 = w.id;
    try {
      // Estado anterior: prompt/KB da versão de 24/09 e cadência com marcadores.
      const base = defaultArcadaSeedContent();
      const legacy = {
        ...base,
        systemPrompt: 'Prompt de 24/09: R$ 1.000 / R$ 2.500 / R$ 5.000, {{nivel_1000_inclui}}.',
        kbDocuments: base.kbDocuments.map((d) => ({
          ...d,
          rawContent: `${d.key}: versão de 24/09`,
        })),
      };
      const first = await withWorkspace(ws33, (tx) => seedArcadaAttendance(tx, ws33, legacy));
      await db
        .update(flows)
        .set({ nodes: legacyCadenceNodes(first.tagIds) })
        .where(eq(flows.id, first.flowIds.cadence));
      // O operador já publicou o portfólio: a KB publicada não pode ser tocada.
      const portfolioId = arcadaIds(ws33).kbDocumentId('portfolio');
      await db
        .update(kbDocuments)
        .set({ status: 'active', visibleToAgents: true })
        .where(eq(kbDocuments.id, portfolioId));

      const report = await withWorkspace(ws33, (tx) => seedArcadaAttendance(tx, ws33));
      expect(report.draftPromptVersion).toBe(2);
      expect(report.created).toEqual(
        expect.arrayContaining([
          'prompt_version:2:draft',
          'kb:niveis:updated',
          'kb:faq:updated',
          'flow:cadence:templates:3',
        ]),
      );
      expect(report.created).not.toContain('kb:portfolio:updated');

      const versions = await db
        .select()
        .from(agentPromptVersions)
        .where(eq(agentPromptVersions.agentId, report.agentId));
      const byVersion = new Map(versions.map((v) => [v.version, v]));
      expect(byVersion.get(1)).toMatchObject({ status: 'live', systemPrompt: legacy.systemPrompt });
      expect(byVersion.get(2)).toMatchObject({ status: 'draft', systemPrompt: base.systemPrompt });

      const [agent] = await db.select().from(agents).where(eq(agents.id, report.agentId));
      expect(agent).toMatchObject({ status: 'inactive', systemPrompt: legacy.systemPrompt });

      const docs = await db.select().from(kbDocuments).where(eq(kbDocuments.workspaceId, ws33));
      const byId = new Map(docs.map((d) => [d.id, d]));
      for (const d of base.kbDocuments) {
        const row = byId.get(arcadaIds(ws33).kbDocumentId(d.key));
        if (d.key === 'portfolio') {
          expect(row?.rawContent).toBe('portfolio: versão de 24/09');
        } else {
          expect(row).toMatchObject({ status: 'draft', rawContent: d.rawContent });
        }
      }

      const [cadence] = await db.select().from(flows).where(eq(flows.id, report.flowIds.cadence));
      expect(cadence?.status).toBe('draft');
      expect(cadence?.nodes).toEqual(buildCadenceFlowGraph(report.tagIds).nodes);

      // 2ª rodada: nada criado.
      const again = await withWorkspace(ws33, (tx) => seedArcadaAttendance(tx, ws33));
      expect(again.created).toEqual([]);
      expect(again.draftPromptVersion).toBeNull();
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, ws33));
    }
  });
});
