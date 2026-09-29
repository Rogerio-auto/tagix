/**
 * Seed do agente de atendimento da Arcada (F70-S06), POR WORKSPACE.
 *
 * O que semeia no workspace da Arcada (conteúdo em `agent_templates_arcada.content.ts`):
 *  - `agent_templates` do WORKSPACE (não global): o prompt carrega preços e limites
 *    comerciais do Rogério — um template global ficaria legível para todo tenant.
 *  - `agents` "Arcada — atendimento", status `inactive` (o worker não responde com
 *    agente inativo) + `agent_prompt_versions` v1 `live` (baseline do histórico,
 *    mesmo contrato do POST /api/agents) + `agent_tools` das tools já catalogadas.
 *  - `tags`: `ia-arcada`, `atendimento-humano`, `esfriou`.
 *  - `kb_documents` em `draft` e `visible_to_agents=false` (FAQ com marcadores;
 *    sem chunks — a indexação é do worker de ingest, disparada pelo "Reprocessar").
 *  - 2 `flows` em `draft` (nada dispara; sem `flow_versions`):
 *      * ativação: `new_message` → `ai_action ACTIVATE`, travado pela origem (F70-S07);
 *      * cadência sem resposta: 24h / 3º dia / 7º dia + `esfriou` / 30 dias.
 *
 * NADA É ATIVADO: agente inativo, flows em rascunho, KB invisível.
 *
 * Idempotência e respeito às edições feitas pela UI (ids determinísticos, UUIDv5
 * por workspace + chave):
 *  - template: upsert por PK (é do seed; o conteúdo do seed vence).
 *  - agente: criado uma vez. Se já existe, os campos live NÃO são tocados; se o
 *    prompt/modelo do seed mudou e ainda não existe versão igual, grava um DRAFT
 *    (staging: o Rogério publica pela UI). Rodar 2x sem mudança não cria nada.
 *  - tags: UNIQUE (workspace, name) → do nothing.
 *  - agent_tools: PK (agent, tool); a liberação das tools de contato (F70-S23) só é
 *    gravada enquanto `overrides` estiver vazio — a edição do operador vence.
 *  - KB: criado uma vez; re-rodar atualiza o texto só enquanto o doc está em
 *    `draft` e invisível (depois de publicado, a UI manda).
 *  - flows: criados uma vez; nunca sobrescritos (o Rogério edita/publica na UI). Única
 *    exceção (F70-S33): na cadência ainda em `draft`, o `templateName` que continua igual
 *    ao marcador da versão anterior (`{{modelo_…}}`) recebe o nome do modelo definido.
 *
 * RLS-safe: recebe a transação já escopada (`withWorkspace`), como o instanciador de
 * Niche Blueprint. Execução: `agent_templates_arcada.run.ts`.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { DbTx } from '../client';
import {
  agentPromptVersions,
  agentTemplates,
  agentTools,
  agents,
  flows,
  kbDocuments,
  llmModelsWhitelist,
  tags,
  tools,
  workspaceAgentPolicies,
} from '../schema';
import {
  ARCADA_CADENCE,
  ARCADA_LEGACY_TEMPLATE_MARKERS,
  ARCADA_MODEL,
  ARCADA_MODEL_PARAMS,
  ARCADA_PREFILLED_FOR_APPROVAL,
  ARCADA_TAGS,
  buildArcadaKbDocuments,
  buildArcadaSystemPrompt,
  listPendingMarkers,
  type ArcadaKbDocument,
  type ArcadaTagKey,
} from './agent_templates_arcada.content';
import { ARCADA_AGENT_TOOL_OVERRIDES, seededToolOverrides } from './tools_agent_grants';

// ─── Ids determinísticos.

/** Namespace UUIDv5 do seed da Arcada (nunca muda). */
const ARCADA_NS = 'a9e7c0d1-0070-4070-8070-000000000006';

/** UUIDv5 (namespace + nome → SHA-1), mesmo algoritmo dos outros seeds de template. */
function uuidv5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name, 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const ARCADA_TEMPLATE_KEY = 'arcada_attendance';
export const ARCADA_AGENT_NAME = 'Arcada — atendimento';
export const ARCADA_ACTIVATION_FLOW_NAME = 'Arcada — ligar IA (conversa iniciada pelo cliente)';
export const ARCADA_CADENCE_FLOW_NAME = 'Arcada — cadência sem resposta';

/** Tools habilitadas no agente (resolvidas no catálogo `tools`; ausentes são reportadas). */
export const ARCADA_TOOL_KEYS = [
  'transfer_to_human',
  'search_knowledge_base',
  'add_contact_tag',
  'query_contact',
  'update_contact',
] as const;

export interface ArcadaIds {
  readonly templateId: string;
  readonly agentId: string;
  readonly activationFlowId: string;
  readonly cadenceFlowId: string;
  kbDocumentId(key: string): string;
}

export function arcadaIds(workspaceId: string): ArcadaIds {
  const id = (name: string) => uuidv5(`${workspaceId}:${name}`, ARCADA_NS);
  return {
    templateId: id(`template:${ARCADA_TEMPLATE_KEY}`),
    agentId: id('agent:arcada_attendance'),
    activationFlowId: id('flow:activation'),
    cadenceFlowId: id('flow:cadence'),
    kbDocumentId: (key) => id(`kb:${key}`),
  };
}

// ─── Grafos dos flows (shape persistido em flows.nodes/edges — FlowNode/FlowEdge).

export interface SeedFlowNode {
  readonly id: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly position: { x: number; y: number };
}

export interface SeedFlowEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly sourceHandle?: string;
}

export interface SeedFlowGraph {
  readonly nodes: SeedFlowNode[];
  readonly edges: SeedFlowEdge[];
}

type TagIds = Readonly<Record<ArcadaTagKey, string>>;

const col = (i: number) => i * 280;
const row = (i: number) => i * 140;

/**
 * Ativação: dispara a cada mensagem DO CONTATO (`new_message`; o `new_lead` não é
 * disparado no caminho inbound — ver Decisões do slot).
 *
 *   trigger → já decidida? (HAS_TAG ia-arcada)
 *     true  → fim (nunca religa: respeita handoff, pausa do eco e desligamento manual)
 *     false → ai_action ACTIVATE (trava de origem da F70-S07)
 *               → bloqueada? (HAS_VALUE ai_activation_blocked)
 *                   true  → fim, nada visível ao contato (sem-origem/prospecção)
 *                   false → add_tag ia-arcada
 */
export function buildActivationFlowGraph(agentId: string, tagIds: TagIds): SeedFlowGraph {
  return {
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        data: { label: 'Mensagem do cliente', triggerType: 'new_message', triggerConfig: {} },
        position: { x: col(1), y: row(0) },
      },
      {
        id: 'already_decided',
        type: 'condition',
        data: {
          label: 'IA já decidida para o contato?',
          operator: 'HAS_TAG',
          tagId: tagIds.aiActivated,
        },
        position: { x: col(1), y: row(1) },
      },
      {
        id: 'activate',
        type: 'ai_action',
        data: { label: 'Ligar agente Arcada', action: 'ACTIVATE', agentId },
        position: { x: col(2), y: row(2) },
      },
      {
        id: 'blocked',
        type: 'condition',
        data: {
          label: 'Trava de origem recusou?',
          operator: 'HAS_VALUE',
          variable: 'ai_activation_blocked',
        },
        position: { x: col(2), y: row(3) },
      },
      {
        id: 'mark_activated',
        type: 'add_tag',
        data: { label: 'Marcar ia-arcada', tagId: tagIds.aiActivated },
        position: { x: col(3), y: row(4) },
      },
    ],
    edges: [
      { id: 'e_trigger_decided', source: 'trigger', target: 'already_decided' },
      {
        id: 'e_decided_false',
        source: 'already_decided',
        target: 'activate',
        sourceHandle: 'false',
      },
      { id: 'e_activate_blocked', source: 'activate', target: 'blocked' },
      { id: 'e_blocked_false', source: 'blocked', target: 'mark_activated', sourceHandle: 'false' },
    ],
  };
}

/**
 * Cadência sem resposta. Cada mensagem do contato inicia uma execução nova e a
 * execução anterior é retomada pela aresta `response` (engine: resumeFlowWithResponse)
 * e termina tirando `esfriou` — ou seja, o relógio sempre conta da ÚLTIMA mensagem do
 * cliente, sem ciclo no grafo (a validação de publish proíbe ciclos).
 *
 * Cada lembrete é precedido pela checagem de `atendimento-humano` (humano assumiu →
 * para). O 1º gate também exige `ia-arcada` (só contatos atendidos pela IA).
 */
export function buildCadenceFlowGraph(tagIds: TagIds): SeedFlowGraph {
  const c = ARCADA_CADENCE;
  const waitD3 = c.day3Minutes - c.reminderWithin24hMinutes;
  const waitD7 = c.day7Minutes - c.day3Minutes;
  // Envio sem parâmetros: os modelos da Arcada não têm variáveis (sem `params`).
  const template = (templateName: string) => ({
    templateName,
    languageCode: c.templateLanguage,
  });
  const humanGate = (id: string, y: number): SeedFlowNode => ({
    id,
    type: 'condition',
    data: { label: 'Humano assumiu?', operator: 'HAS_TAG', tagId: tagIds.humanTakeover },
    position: { x: col(2), y: row(y) },
  });

  return {
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        data: { label: 'Mensagem do cliente', triggerType: 'new_message', triggerConfig: {} },
        position: { x: col(1), y: row(0) },
      },
      {
        id: 'wait_24h',
        type: 'wait_for_response',
        data: {
          label: 'Espera resposta (janela de 24h)',
          timeoutMinutes: c.reminderWithin24hMinutes,
        },
        position: { x: col(1), y: row(1) },
      },
      {
        id: 'clear_cooled',
        type: 'remove_tag',
        data: { label: 'Voltou a responder: tira esfriou', tagId: tagIds.cooledDown },
        position: { x: col(0), y: row(6) },
      },
      {
        id: 'served_by_ai',
        type: 'condition',
        data: { label: 'Atendido pela IA?', operator: 'HAS_TAG', tagId: tagIds.aiActivated },
        position: { x: col(2), y: row(2) },
      },
      humanGate('human_24h', 3),
      {
        id: 'reminder_24h',
        type: 'message',
        data: { label: 'Lembrete dentro de 24h', messageType: 'text', text: c.reminderText },
        position: { x: col(2), y: row(4) },
      },
      {
        id: 'wait_d3',
        type: 'wait_for_response',
        data: { label: 'Espera até o 3º dia', timeoutMinutes: waitD3 },
        position: { x: col(2), y: row(5) },
      },
      humanGate('human_d3', 6),
      {
        id: 'template_d3',
        type: 'template',
        data: { label: 'Modelo aprovado — 3º dia', ...template(c.day3TemplateName) },
        position: { x: col(2), y: row(7) },
      },
      {
        id: 'wait_d7',
        type: 'wait_for_response',
        data: { label: 'Espera até o 7º dia', timeoutMinutes: waitD7 },
        position: { x: col(2), y: row(8) },
      },
      humanGate('human_d7', 9),
      {
        id: 'template_d7',
        type: 'template',
        data: { label: 'Modelo aprovado — 7º dia', ...template(c.day7TemplateName) },
        position: { x: col(2), y: row(10) },
      },
      {
        id: 'mark_cooled',
        type: 'add_tag',
        data: { label: 'Etiqueta esfriou', tagId: tagIds.cooledDown },
        position: { x: col(2), y: row(11) },
      },
      {
        id: 'wait_d30',
        type: 'wait_for_response',
        data: { label: 'Espera 30 dias', timeoutMinutes: c.touchAfterCooledMinutes },
        position: { x: col(2), y: row(12) },
      },
      humanGate('human_d30', 13),
      {
        id: 'template_d30',
        type: 'template',
        data: { label: 'Modelo aprovado — toque de 30 dias', ...template(c.day30TemplateName) },
        position: { x: col(2), y: row(14) },
      },
    ],
    edges: [
      { id: 'e_trigger_wait', source: 'trigger', target: 'wait_24h' },
      {
        id: 'e_24h_response',
        source: 'wait_24h',
        target: 'clear_cooled',
        sourceHandle: 'response',
      },
      { id: 'e_24h_timeout', source: 'wait_24h', target: 'served_by_ai', sourceHandle: 'timeout' },
      { id: 'e_served_true', source: 'served_by_ai', target: 'human_24h', sourceHandle: 'true' },
      { id: 'e_h24_false', source: 'human_24h', target: 'reminder_24h', sourceHandle: 'false' },
      { id: 'e_reminder_wait', source: 'reminder_24h', target: 'wait_d3' },
      { id: 'e_d3_response', source: 'wait_d3', target: 'clear_cooled', sourceHandle: 'response' },
      { id: 'e_d3_timeout', source: 'wait_d3', target: 'human_d3', sourceHandle: 'timeout' },
      { id: 'e_hd3_false', source: 'human_d3', target: 'template_d3', sourceHandle: 'false' },
      { id: 'e_tpl3_wait', source: 'template_d3', target: 'wait_d7' },
      { id: 'e_d7_response', source: 'wait_d7', target: 'clear_cooled', sourceHandle: 'response' },
      { id: 'e_d7_timeout', source: 'wait_d7', target: 'human_d7', sourceHandle: 'timeout' },
      { id: 'e_hd7_false', source: 'human_d7', target: 'template_d7', sourceHandle: 'false' },
      { id: 'e_tpl7_cooled', source: 'template_d7', target: 'mark_cooled' },
      { id: 'e_cooled_wait', source: 'mark_cooled', target: 'wait_d30' },
      {
        id: 'e_d30_response',
        source: 'wait_d30',
        target: 'clear_cooled',
        sourceHandle: 'response',
      },
      { id: 'e_d30_timeout', source: 'wait_d30', target: 'human_d30', sourceHandle: 'timeout' },
      { id: 'e_hd30_false', source: 'human_d30', target: 'template_d30', sourceHandle: 'false' },
    ],
  };
}

// ─── Seed.

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Troca, nos nodes `template`, o `templateName` que ainda é marcador da versão anterior
 * (`{{modelo_…}}`) pelo nome definido. Qualquer outro valor fica como está.
 */
export function fillLegacyTemplateNames(nodes: readonly unknown[]): {
  nodes: unknown[];
  changed: number;
} {
  let changed = 0;
  const out = nodes.map((node) => {
    if (!isRecord(node) || node['type'] !== 'template' || !isRecord(node['data'])) return node;
    const current = node['data']['templateName'];
    if (typeof current !== 'string' || !Object.hasOwn(ARCADA_LEGACY_TEMPLATE_MARKERS, current)) {
      return node;
    }
    const name = ARCADA_LEGACY_TEMPLATE_MARKERS[current];
    if (name === undefined) return node;
    changed += 1;
    return { ...node, data: { ...node['data'], templateName: name } };
  });
  return { nodes: out, changed };
}

export interface ArcadaSeedContent {
  readonly systemPrompt: string;
  readonly model: string;
  readonly modelParams: Readonly<Record<string, unknown>>;
  readonly kbDocuments: readonly ArcadaKbDocument[];
}

export function defaultArcadaSeedContent(): ArcadaSeedContent {
  return {
    systemPrompt: buildArcadaSystemPrompt(),
    model: ARCADA_MODEL,
    modelParams: ARCADA_MODEL_PARAMS,
    kbDocuments: buildArcadaKbDocuments(),
  };
}

export interface ArcadaSeedReport {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly templateId: string;
  readonly flowIds: { readonly activation: string; readonly cadence: string };
  readonly tagIds: TagIds;
  /** O que foi criado NESTA execução (vazio na 2ª rodada sem mudança). */
  readonly created: readonly string[];
  /** Versão de prompt gravada como draft nesta execução (prompt do seed mudou). */
  readonly draftPromptVersion: number | null;
  readonly linkedTools: readonly string[];
  readonly missingTools: readonly string[];
  readonly pendingMarkers: readonly string[];
  /** Conteúdo pré-preenchido que aguarda aprovação (marcador → fonte). */
  readonly prefilledForApproval: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

const TEMPLATE_DESCRIPTION =
  'Atendimento consultivo da Arcada (sites para clínicas odontológicas): qualifica, mostra portfólio, agenda, explica preço de lançamento, pagamento e prazo sem sair das condições aprovadas e passa para o Rogério na hora de fechar.';

function sha256(text: string): string {
  return createHash('sha256').update(text.trim(), 'utf8').digest('hex');
}

/** JSON com chaves ordenadas: o jsonb do Postgres NÃO preserva a ordem das chaves. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameParams(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? {}) === canonicalJson(b ?? {});
}

/**
 * Semeia o pacote da Arcada no workspace. `tx` DEVE estar escopada ao workspace
 * (`withWorkspace(workspaceId, (tx) => seedArcadaAttendance(tx, workspaceId))`).
 */
export async function seedArcadaAttendance(
  tx: DbTx,
  workspaceId: string,
  content: ArcadaSeedContent = defaultArcadaSeedContent(),
): Promise<ArcadaSeedReport> {
  const ids = arcadaIds(workspaceId);
  const created: string[] = [];
  const warnings: string[] = [];

  // ─── Modelo: precisa estar na whitelist global e ativo (fail-fast).
  const [model] = await tx
    .select({ slug: llmModelsWhitelist.slug, isActive: llmModelsWhitelist.isActive })
    .from(llmModelsWhitelist)
    .where(eq(llmModelsWhitelist.slug, content.model))
    .limit(1);
  if (!model || !model.isActive) {
    throw new Error(
      `Modelo ${content.model} ausente ou inativo em llm_models_whitelist — rode o seed de modelos antes.`,
    );
  }
  const [policy] = await tx
    .select({ allowedModels: workspaceAgentPolicies.allowedModels })
    .from(workspaceAgentPolicies)
    .where(eq(workspaceAgentPolicies.workspaceId, workspaceId))
    .limit(1);
  if (policy && policy.allowedModels.length > 0 && !policy.allowedModels.includes(content.model)) {
    warnings.push(
      `A policy do workspace restringe os modelos e não inclui ${content.model}: o runtime vai bloquear o agente até o super-admin liberar.`,
    );
  }

  // ─── Template do workspace (conteúdo do seed vence).
  await tx
    .insert(agentTemplates)
    .values({
      id: ids.templateId,
      workspaceId,
      key: ARCADA_TEMPLATE_KEY,
      name: ARCADA_AGENT_NAME,
      category: 'Comercial',
      description: TEMPLATE_DESCRIPTION,
      promptTemplate: content.systemPrompt,
      defaultModel: content.model,
      defaultModelParams: { ...content.modelParams },
      defaultTools: [...ARCADA_TOOL_KEYS],
      isGlobal: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentTemplates.id,
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        description: sql`excluded.description`,
        promptTemplate: sql`excluded.prompt_template`,
        defaultModel: sql`excluded.default_model`,
        defaultModelParams: sql`excluded.default_model_params`,
        defaultTools: sql`excluded.default_tools`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  // ─── Agente (inativo) + baseline de versão.
  const [existingAgent] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, ids.agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);

  let draftPromptVersion: number | null = null;
  if (!existingAgent) {
    await tx.insert(agents).values({
      id: ids.agentId,
      workspaceId,
      templateId: ids.templateId,
      name: ARCADA_AGENT_NAME,
      description: TEMPLATE_DESCRIPTION,
      systemPrompt: content.systemPrompt,
      model: content.model,
      modelParams: { ...content.modelParams },
      status: 'inactive',
      allowHandoff: true,
      ignoreGroupMessages: true,
    });
    await tx.insert(agentPromptVersions).values({
      workspaceId,
      agentId: ids.agentId,
      version: 1,
      status: 'live',
      systemPrompt: content.systemPrompt,
      model: content.model,
      modelParams: { ...content.modelParams },
      label: 'Versão inicial (F70-S06) — aguardando aprovação',
      note: 'Semeada por agent_templates_arcada.ts. Agente inativo até o Rogério aprovar.',
      publishedAt: new Date(),
    });
    created.push('agent', 'prompt_version:1');
  } else {
    // Não toca o live. Se o conteúdo do seed é novo, estaciona como draft.
    const versions = await tx
      .select({
        version: agentPromptVersions.version,
        systemPrompt: agentPromptVersions.systemPrompt,
        model: agentPromptVersions.model,
        modelParams: agentPromptVersions.modelParams,
      })
      .from(agentPromptVersions)
      .where(eq(agentPromptVersions.agentId, ids.agentId))
      .orderBy(desc(agentPromptVersions.version));
    const alreadyVersioned = versions.some(
      (v) =>
        v.systemPrompt === content.systemPrompt &&
        v.model === content.model &&
        sameParams(v.modelParams, content.modelParams),
    );
    if (!alreadyVersioned) {
      const next = (versions[0]?.version ?? 0) + 1;
      await tx.insert(agentPromptVersions).values({
        workspaceId,
        agentId: ids.agentId,
        version: next,
        status: 'draft',
        systemPrompt: content.systemPrompt,
        model: content.model,
        modelParams: { ...content.modelParams },
        label: `Seed da Arcada (v${next}) — rascunho para aprovação`,
        note: `Conteúdo do seed mudou (modelo ${content.model}); rascunho para revisão. O live não foi alterado.`,
      });
      draftPromptVersion = next;
      created.push(`prompt_version:${next}:draft`);
    }
  }

  // ─── Tools (catálogo global ou do workspace).
  const toolRows = await tx
    .select({ id: tools.id, key: tools.key })
    .from(tools)
    .where(
      and(
        inArray(tools.key, [...ARCADA_TOOL_KEYS]),
        eq(tools.isActive, true),
        or(isNull(tools.workspaceId), eq(tools.workspaceId, workspaceId)),
      ),
    );
  if (toolRows.length > 0) {
    // Liberações de escrita das tools de contato (F70-S23): negação por padrão, e a
    // Arcada só aplica `atendimento-humano`. Vínculo que já existe recebe a liberação
    // apenas enquanto `overrides` estiver vazio — o que o operador mudou pela UI vence.
    await tx
      .insert(agentTools)
      .values(
        toolRows.map((t) => ({
          agentId: ids.agentId,
          toolId: t.id,
          isEnabled: true,
          overrides: seededToolOverrides(ARCADA_AGENT_TOOL_OVERRIDES, t.key),
        })),
      )
      .onConflictDoUpdate({
        target: [agentTools.agentId, agentTools.toolId],
        set: { overrides: sql`excluded.overrides` },
        setWhere: sql`${agentTools.overrides} = '{}'::jsonb and excluded.overrides <> '{}'::jsonb`,
      });
  }
  const linkedTools = ARCADA_TOOL_KEYS.filter((k) => toolRows.some((t) => t.key === k));
  const missingTools = ARCADA_TOOL_KEYS.filter((k) => !linkedTools.includes(k));
  if (missingTools.length > 0) {
    warnings.push(
      `Tools ausentes no catálogo \`tools\` (não vinculadas): ${missingTools.join(', ')}.`,
    );
  }

  // ─── Tags.
  const tagEntries = Object.entries(ARCADA_TAGS) as [
    ArcadaTagKey,
    (typeof ARCADA_TAGS)[ArcadaTagKey],
  ][];
  const insertedTags = await tx
    .insert(tags)
    .values(tagEntries.map(([, t]) => ({ workspaceId, name: t.name, color: t.color })))
    .onConflictDoNothing({ target: [tags.workspaceId, tags.name] })
    .returning({ name: tags.name });
  for (const t of insertedTags) created.push(`tag:${t.name}`);
  const tagRows = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(
      and(
        eq(tags.workspaceId, workspaceId),
        inArray(
          tags.name,
          tagEntries.map(([, t]) => t.name),
        ),
      ),
    );
  const tagIdOf = (key: ArcadaTagKey): string => {
    const found = tagRows.find((r) => r.name === ARCADA_TAGS[key].name);
    if (!found) throw new Error(`Tag ${ARCADA_TAGS[key].name} não encontrada após o upsert.`);
    return found.id;
  };
  const tagIds: TagIds = {
    aiActivated: tagIdOf('aiActivated'),
    humanTakeover: tagIdOf('humanTakeover'),
    cooledDown: tagIdOf('cooledDown'),
  };

  // ─── Base de conhecimento (draft + invisível).
  for (const doc of content.kbDocuments) {
    const docId = ids.kbDocumentId(doc.key);
    const [existing] = await tx
      .select({
        id: kbDocuments.id,
        status: kbDocuments.status,
        visibleToAgents: kbDocuments.visibleToAgents,
        contentSha256: kbDocuments.contentSha256,
      })
      .from(kbDocuments)
      .where(eq(kbDocuments.id, docId))
      .limit(1);
    const hash = sha256(doc.rawContent);
    if (!existing) {
      await tx.insert(kbDocuments).values({
        id: docId,
        workspaceId,
        title: doc.title,
        source: 'manual',
        category: doc.category,
        tags: [...doc.tags],
        language: 'pt-BR',
        priority: 5,
        status: 'draft',
        visibleToAgents: false,
        rawContent: doc.rawContent,
        contentSha256: hash,
      });
      created.push(`kb:${doc.key}`);
    } else if (
      existing.status === 'draft' &&
      !existing.visibleToAgents &&
      existing.contentSha256 !== hash
    ) {
      await tx
        .update(kbDocuments)
        .set({
          title: doc.title,
          category: doc.category,
          tags: [...doc.tags],
          rawContent: doc.rawContent,
          contentSha256: hash,
          version: sql`${kbDocuments.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(kbDocuments.id, docId));
      created.push(`kb:${doc.key}:updated`);
    }
  }

  // ─── Flows (draft; criados uma vez).
  const flowSpecs = [
    {
      id: ids.activationFlowId,
      name: ARCADA_ACTIVATION_FLOW_NAME,
      description:
        'Liga o agente Arcada na primeira mensagem do cliente. A trava de origem (F70-S07) recusa sem-origem/prospecção; nesse caso nada acontece para o contato.',
      graph: buildActivationFlowGraph(ids.agentId, tagIds),
      key: 'activation',
    },
    {
      id: ids.cadenceFlowId,
      name: ARCADA_CADENCE_FLOW_NAME,
      description:
        'Sem resposta do cliente: lembrete dentro de 24h, modelo aprovado no 3º e no 7º dia, etiqueta esfriou e um toque 30 dias depois. Para se um humano assumir.',
      graph: buildCadenceFlowGraph(tagIds),
      key: 'cadence',
    },
  ] as const;
  for (const f of flowSpecs) {
    const inserted = await tx
      .insert(flows)
      .values({
        id: f.id,
        workspaceId,
        name: f.name,
        description: f.description,
        status: 'draft',
        triggerType: 'new_message',
        triggerConfig: {},
        nodes: [...f.graph.nodes],
        edges: [...f.graph.edges],
      })
      .onConflictDoNothing({ target: flows.id })
      .returning({ id: flows.id });
    if (inserted.length > 0) created.push(`flow:${f.key}`);
  }

  // ─── Cadência já existente: nomes dos modelos (F70-S33). Só em RASCUNHO e só o
  // `templateName` que ainda é o marcador da versão anterior do seed (a edição do
  // operador vence; um flow publicado nunca é tocado).
  const [cadence] = await tx
    .select({ status: flows.status, nodes: flows.nodes })
    .from(flows)
    .where(eq(flows.id, ids.cadenceFlowId))
    .limit(1);
  if (cadence && cadence.status === 'draft') {
    const { nodes: migrated, changed } = fillLegacyTemplateNames(cadence.nodes);
    if (changed > 0) {
      await tx
        .update(flows)
        .set({ nodes: migrated, updatedAt: new Date() })
        .where(and(eq(flows.id, ids.cadenceFlowId), eq(flows.status, 'draft')));
      created.push(`flow:cadence:templates:${changed}`);
    }
  }

  return {
    workspaceId,
    agentId: ids.agentId,
    templateId: ids.templateId,
    flowIds: { activation: ids.activationFlowId, cadence: ids.cadenceFlowId },
    tagIds,
    created,
    draftPromptVersion,
    linkedTools,
    missingTools,
    pendingMarkers: listPendingMarkers(),
    prefilledForApproval: ARCADA_PREFILLED_FOR_APPROVAL,
    warnings,
  };
}
