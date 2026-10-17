/**
 * Registro de ferramentas do Copiloto (F73-S03; COPILOTO.md §3, §5.4; ADR-003 §3).
 *
 * Cada área (read-crm S06, read-ops S07, act-crm S08, act-external S09, memory-tools S11)
 * exporta `tools: readonly CopilotToolDefinition[]`, construídas com `defineCopilotTool`; a
 * composição fica em `internal/copilot/index.ts`.
 *
 * Invariantes garantidas na construção (`createCopilotToolRegistry` lança no boot):
 * - `key` válida (`CopilotToolKeySchema`) e única;
 * - `args` é um `z.object(...).strict()` (direto ou sob refinamentos): campo extra é
 *   `invalid_args`, nunca ignorado em silêncio;
 * - nenhum campo de identidade em `args` (`member_id`, `workspace_id`…): a identidade vem
 *   só do grant (ADR-003 §3; COPILOTO.md §8 R2);
 * - `label` vem do catálogo (`statusLabelFor`), nunca da ferramenta nem do modelo.
 *
 * O modelo só VÊ as ferramentas que o membro pode usar (`listToolDescriptorsFor`): o JSON
 * Schema dos `args` é gerado do mesmo Zod que valida a chamada.
 */
import { randomBytes } from 'node:crypto';
import {
  extendZodWithOpenApi,
  OpenApiGeneratorV31,
  OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { ClaimedToolCall, DbTx } from '@hm/db';
import {
  COPILOT_STREAM_VERSION,
  CopilotToolDescriptorSchema,
  CopilotToolKeySchema,
  ToolResultEventSchema,
  can,
  statusLabelFor,
  type CapabilityKey,
  type CopilotToolDescriptor,
  type CopilotToolEnvelope,
  type CopilotToolResultEvent,
  type Permission,
  type QueryArea,
  type ToolResultCard,
} from '@hm/shared';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';

// O gerador de JSON Schema do repositório (Zod v3) é o `zod-to-openapi` (OpenAPI 3.1 =
// JSON Schema 2020-12). Idempotente: a API pública v1 aplica o mesmo patch.
extendZodWithOpenApi(z);

/** Cartão de resultado sem o `result_id`, que é sempre gerado pelo Node (P5). */
export type ToolResultCardInput = ToolResultCard extends infer C
  ? C extends ToolResultCard
    ? Omit<C, 'result_id'>
    : never
  : never;

/** O que `emitResult` devolve: espalhe no envelope (`{ ...emitted, ok, decision, model_view }`). */
export interface EmittedResult {
  readonly result_id: string;
  readonly public_event: CopilotToolResultEvent;
}

/** Contexto de execução de uma ferramenta. Tudo aqui já foi autorizado pelo callback. */
export interface CopilotToolContext {
  /** Transação RLS do workspace do grant (savepoint próprio da ferramenta). */
  readonly tx: DbTx;
  /** Membro recarregado agora (papel, status, assinatura, matriz). */
  readonly principal: CopilotPrincipal;
  /** Turno já consumido por esta chamada (`claimToolCall`). */
  readonly turn: ClaimedToolCall;
  /** `call_id` do runtime (correlação; não é segredo nem identidade). */
  readonly callId: string;
  /**
   * Registra um cartão mostrável (P5: o número na tela vem do banco). Gera o `result_id`,
   * valida o evento público contra o contrato e devolve o par para o envelope.
   */
  emitResult(card: ToolResultCardInput): EmittedResult;
}

/** Definição de uma ferramenta, como as áreas a escrevem. */
export interface CopilotToolSpec<Args> {
  /** `list_deals`, `propose_deal_move`: o `:key` do callback. */
  readonly key: string;
  /** Capacidade do catálogo (`CAPABILITIES`). Consultas são `query`. */
  readonly capability: CapabilityKey;
  /** Área lida (só consultas): escolhe o rótulo de `status` do catálogo. */
  readonly area?: QueryArea;
  /** Para o modelo: o que faz e quando usar. Texto do código, nunca de dado de cliente. */
  readonly description: string;
  /** `z.object({...}).strict()`, sem campos de identidade. */
  readonly args: z.ZodType<Args, z.ZodTypeDef, unknown>;
  /** Permissões de entidade além da capacidade (ex.: `pipeline.view`). */
  readonly requires?: readonly Permission[];
  /** Lê conteúdo escrito por contato → marca o turno (ADR-004 §6). */
  readonly taintsTurn: boolean;
  /** Volume real da chamada (`message.send` com 2+ muda a permissão). Default 1. */
  targetCount?(args: Args): number;
  handler(ctx: CopilotToolContext, args: Args): Promise<CopilotToolEnvelope>;
}

/** Ferramenta registrada. `label` vem do catálogo. */
export interface CopilotToolDefinition<
  Args = Record<string, unknown>,
> extends CopilotToolSpec<Args> {
  /** Rótulo do `status` público ("Lendo o pipeline…"), sempre do catálogo. */
  readonly label: string;
}

/** Campos que nunca podem existir em `args`: a identidade vem só do grant. */
const IDENTITY_ARG_KEYS: ReadonlySet<string> = new Set([
  'member_id',
  'memberid',
  'workspace_id',
  'workspaceid',
  'requested_by_member_id',
  'actor',
  'actor_member_id',
  'executed_as_member_id',
  'turn_id',
  'grant',
]);

/** Desembrulha refinamentos/transformações até o `ZodObject` (ou `null`). */
function innerObject(schema: z.ZodTypeAny): z.AnyZodObject | null {
  let current: z.ZodTypeAny = schema;
  for (let depth = 0; depth < 8; depth++) {
    if (current instanceof z.ZodObject) return current;
    if (current instanceof z.ZodEffects) {
      current = current.innerType();
      continue;
    }
    return null;
  }
  return null;
}

function assertSafeArgs(key: string, args: z.ZodTypeAny): void {
  const obj = innerObject(args);
  if (!obj) throw new Error(`copilot tool '${key}': args precisa ser z.object(...).strict().`);
  if (obj._def.unknownKeys !== 'strict') {
    throw new Error(`copilot tool '${key}': args precisa ser .strict() (ADR-003 §3).`);
  }
  for (const field of Object.keys(obj.shape)) {
    if (IDENTITY_ARG_KEYS.has(field.toLowerCase())) {
      throw new Error(`copilot tool '${key}': campo de identidade proibido em args: '${field}'.`);
    }
  }
}

/**
 * Define uma ferramenta: valida as invariantes, preenche o `label` do catálogo e apaga o
 * tipo dos `args` para o registro heterogêneo. O handler continua recebendo `Args`
 * (o callback só o chama com a saída do próprio `args.safeParse`).
 */
export function defineCopilotTool<Args>(spec: CopilotToolSpec<Args>): CopilotToolDefinition {
  const key = CopilotToolKeySchema.safeParse(spec.key);
  if (!key.success) throw new Error(`copilot tool: key inválida '${spec.key}'.`);
  assertSafeArgs(spec.key, spec.args);
  const definition: CopilotToolDefinition<Args> = {
    ...spec,
    label: statusLabelFor(spec.capability, spec.area).label,
  };
  // Apagamento de tipo deliberado: `Args` só entra pelo `safeParse` do próprio schema.
  return definition as unknown as CopilotToolDefinition;
}

export interface CopilotToolRegistry {
  get(key: string): CopilotToolDefinition | undefined;
  list(): readonly CopilotToolDefinition[];
}

/** Monta o registro. Lança no boot se houver chave repetida ou ferramenta inválida. */
export function createCopilotToolRegistry(
  tools: readonly CopilotToolDefinition[],
): CopilotToolRegistry {
  const byKey = new Map<string, CopilotToolDefinition>();
  for (const tool of tools) {
    if (!CopilotToolKeySchema.safeParse(tool.key).success) {
      throw new Error(`copilot tool: key inválida '${tool.key}'.`);
    }
    assertSafeArgs(tool.key, tool.args);
    if (byKey.has(tool.key)) throw new Error(`copilot tool: key repetida '${tool.key}'.`);
    byKey.set(tool.key, tool);
  }
  const frozen = Object.freeze([...byKey.values()]);
  return {
    get: (key) => byKey.get(key),
    list: () => frozen,
  };
}

// ─── Descritores para o modelo ──────────────────────────────────────────────────

const parametersCache = new WeakMap<z.ZodTypeAny, Record<string, unknown>>();

/** JSON Schema (OpenAPI 3.1 / JSON Schema 2020-12) dos `args`, memoizado por schema. */
export function argsJsonSchema(key: string, args: z.ZodTypeAny): Record<string, unknown> {
  const cached = parametersCache.get(args);
  if (cached) return cached;
  const registry = new OpenAPIRegistry();
  registry.register(key, args);
  const generated: unknown = new OpenApiGeneratorV31(registry.definitions).generateComponents()
    .components?.schemas?.[key];
  const parsed = z.record(z.string(), z.unknown()).safeParse(generated);
  if (!parsed.success) throw new Error(`copilot tool '${key}': JSON Schema não gerado.`);
  parametersCache.set(args, parsed.data);
  return parsed.data;
}

/**
 * A ferramenta é oferecida a este membro? Capacidade efetiva (papel ∧ matriz) e as
 * permissões de entidade. Assinatura e orçamento NÃO escondem ferramenta: a escrita é
 * recusada na chamada, com `action_blocked` explicando por quê (ADR-003 §5).
 */
export function toolOfferedTo(principal: CopilotPrincipal, tool: CopilotToolDefinition): boolean {
  if (principal.memberStatus !== 'active' || !principal.settings.enabled) return false;
  if (!principal.effectiveCapabilities[tool.capability].allowed) return false;
  return (tool.requires ?? []).every((perm) => can(principal.role, perm));
}

/** Ferramentas que o modelo vê neste turno. O que o membro não pode usar não aparece. */
export function listToolDescriptorsFor(
  principal: CopilotPrincipal,
  tools: readonly CopilotToolDefinition[],
): CopilotToolDescriptor[] {
  return tools
    .filter((tool) => toolOfferedTo(principal, tool))
    .map((tool) =>
      CopilotToolDescriptorSchema.parse({
        key: tool.key,
        description: tool.description,
        parameters: argsJsonSchema(tool.key, tool.args),
      }),
    );
}

// ─── Resultados ────────────────────────────────────────────────────────────────

/** `result_id` opaco, gerado pelo Node (`res_` + 96 bits base64url). */
export function newResultId(): string {
  return `res_${randomBytes(12).toString('base64url')}`;
}

/** Implementação de `CopilotToolContext.emitResult`: valida contra o contrato público. */
export function emitToolResult(card: ToolResultCardInput): EmittedResult {
  const resultId = newResultId();
  const event = ToolResultEventSchema.parse({
    ...card,
    result_id: resultId,
    v: COPILOT_STREAM_VERSION,
    type: 'tool_result',
  });
  return { result_id: resultId, public_event: event };
}
