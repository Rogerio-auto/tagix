/**
 * Tools do agente para o `POST /run` (F70-S10, AGENTS_LANGGRAPH §6/§8.1).
 *
 * O runtime só oferece ao modelo as tools que chegam em `req.tools` (o registry
 * Python conhece todas; o que filtra é o request). Aqui o Node resolve, sob a RLS do
 * workspace, as tools **habilitadas** para o agente:
 *
 * ```
 * agent_tools (is_enabled, RLS via agents) ⋈ tools (ativa; global OU do workspace)
 *   → config = deepMerge(tools.handler_config, agent_tools.overrides)
 *   → ToolDescriptor (Zod do contrato @hm/agents-client)
 *   → filtro da policy (categorias permitidas + teto max_tools_per_agent)
 * ```
 *
 * O filtro da policy é o MESMO de `apps/agent-runtime/app/policy.py#filter_tools`
 * (o runtime reaplica como defesa em profundidade): categorias vazias = sem restrição;
 * teto >= 0 corta preservando a ordem; negativo = sem teto. A ordem é estável
 * (categoria, key) para o corte do teto e o prompt serem determinísticos.
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { DbTx } from '@hm/db';
import { ToolDescriptorSchema } from '@hm/agents-client';
import type { PolicySnapshot, ToolDescriptor } from '@hm/agents-client';

/** Linha crua de `agent_tools ⋈ tools` (o que o loader lê do banco). */
export interface AgentToolRow {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly handlerConfig: Record<string, unknown>;
  readonly overrides: Record<string, unknown>;
}

/** Descritores válidos + keys descartadas por não passarem no contrato. */
export interface ToolDescriptorBuild {
  readonly tools: ToolDescriptor[];
  readonly rejected: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge de `overrides` sobre `base` (objetos recursivos; array/escalar do override
 * substitui). Não muta as entradas. Semântica documentada em `agent_tools.overrides`.
 */
export function deepMerge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out;
}

/** Linhas → `ToolDescriptor[]` validados no contrato. Linha inválida é descartada. */
export function toToolDescriptors(rows: readonly AgentToolRow[]): ToolDescriptorBuild {
  const tools: ToolDescriptor[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // Defesa: key repetida nunca vira duas tools no request (o loader já deduplica).
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    const config = deepMerge(
      isPlainObject(row.handlerConfig) ? row.handlerConfig : {},
      isPlainObject(row.overrides) ? row.overrides : {},
    );
    const parsed = ToolDescriptorSchema.safeParse({
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      ...(Object.keys(config).length > 0 ? { config } : {}),
    });
    if (parsed.success) tools.push(parsed.data);
    else rejected.push(row.key);
  }
  return { tools, rejected };
}

/** Filtro da policy — espelho exato de `filter_tools` do runtime. */
export function filterToolsByPolicy(
  tools: readonly ToolDescriptor[],
  policy: Pick<PolicySnapshot, 'allowed_tool_categories' | 'max_tools_per_agent'>,
): ToolDescriptor[] {
  const allowed = new Set(policy.allowed_tool_categories);
  const filtered = allowed.size > 0 ? tools.filter((t) => allowed.has(t.category)) : [...tools];
  return policy.max_tools_per_agent >= 0 ? filtered.slice(0, policy.max_tools_per_agent) : filtered;
}

/**
 * Lê as tools habilitadas do agente. `tx` DEVE ser RLS-escopado ao `workspaceId`
 * (`withWorkspace`): `agent_tools` isola por `agents`; `tools` não tem RLS (as globais
 * são de todos), então o filtro global-OU-do-workspace é explícito aqui.
 * Custom do workspace sobrepõe a global de mesma key.
 */
export async function loadAgentToolRows(
  tx: DbTx,
  workspaceId: string,
  agentId: string,
): Promise<AgentToolRow[]> {
  const { agentTools, tools } = schema;
  const rows = await tx
    .select({
      key: tools.key,
      name: tools.name,
      description: tools.description,
      category: tools.category,
      handlerConfig: tools.handlerConfig,
      overrides: agentTools.overrides,
      workspaceId: tools.workspaceId,
    })
    .from(agentTools)
    .innerJoin(tools, eq(tools.id, agentTools.toolId))
    .where(
      and(
        eq(agentTools.agentId, agentId),
        eq(agentTools.isEnabled, true),
        eq(tools.isActive, true),
        or(isNull(tools.workspaceId), eq(tools.workspaceId, workspaceId)),
      ),
    )
    .orderBy(asc(tools.category), asc(tools.key));

  // Uma linha por key: a custom do workspace vence a global de mesma key. A ordem
  // (categoria, key) do SQL é preservada entre as vencedoras.
  const winners = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const current = winners.get(r.key);
    if (current === undefined || (current.workspaceId === null && r.workspaceId !== null)) {
      winners.set(r.key, r);
    }
  }
  return rows
    .filter((r) => winners.get(r.key) === r)
    .map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      category: r.category,
      handlerConfig: r.handlerConfig,
      overrides: r.overrides,
    }));
}
