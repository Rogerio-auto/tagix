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
 * - nenhum campo de identidade em `args` (`member_id`, `workspace_id`, `actor_*`…), em
 *   qualquer profundidade (objetos aninhados, arrays, uniões): a identidade vem só do grant
 *   (ADR-003 §3; COPILOTO.md §8 R2);
 * - `label` vem do catálogo (`statusLabelFor`), nunca da ferramenta nem do modelo;
 * - capacidade de ESCRITA só entra pelo motor de propostas (`makeProposeTool`, que usa
 *   `defineEngineTool`): `authorization: 'engine'`. Qualquer outra escrita lança no boot, e
 *   `defineCopilotTool` recusa escrita já na definição (F73-S05; ADR-004 §1).
 *
 * O modelo só VÊ as ferramentas que o membro pode usar (`listToolDescriptorsFor`): o JSON
 * Schema dos `args` é gerado do mesmo Zod que valida a chamada. Escritas (`propose_*`) são
 * oferecidas também a quem não pode executá-las mas tem a quem pedir aprovação: a recusa vira
 * proposta `blocked` com "Pedir aprovação" (ADR-003 §7), e não silêncio.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import {
  extendZodWithOpenApi,
  OpenApiGeneratorV31,
  OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { schema, type ClaimedToolCall, type DbTx } from '@hm/db';
import {
  COPILOT_STREAM_VERSION,
  CopilotToolDescriptorSchema,
  CopilotToolKeySchema,
  ROLES,
  ToolResultEventSchema,
  can,
  capabilityAllowed,
  copilotAccessFor,
  isWriteCapability,
  statusLabelFor,
  type CapabilityKey,
  type CopilotToolDescriptor,
  type CopilotToolEnvelope,
  type CopilotToolResultEvent,
  type Permission,
  type QueryArea,
  type Role,
  type ToolResultCard,
} from '@hm/shared';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import type { AfterCommitFn } from './executor-types';

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
  /**
   * Agenda um efeito (socket, fila) para DEPOIS do commit da transação do callback. Se a
   * ferramenta falhar (savepoint desfeito) ou a transação do callback não commitar, a fila é
   * descartada: nada sai sobre um dado que não existe.
   */
  afterCommit(fn: AfterCommitFn): void;
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

/**
 * Quem autoriza papel/matriz/assinatura/orçamento:
 * - ausente (`callback`): o callback, antes do handler (consultas);
 * - `engine`: o motor de propostas, com o volume real dos alvos; o callback só confere turno,
 *   grant, membro ativo, Copiloto ligado (e `copilot.use`), `requires` e orçamento `paused`.
 */
export type CopilotToolAuthorization = 'engine';

/** Ferramenta registrada. `label` vem do catálogo. */
export interface CopilotToolDefinition<
  Args = Record<string, unknown>,
> extends CopilotToolSpec<Args> {
  /** Rótulo do `status` público ("Lendo o pipeline…"), sempre do catálogo. */
  readonly label: string;
  /** `engine` só pelo `defineEngineTool` (motor de propostas). */
  readonly authorization?: CopilotToolAuthorization;
}

/**
 * Definições criadas pelo `defineEngineTool`. O campo `authorization` sozinho não basta (um
 * objeto copiado ou montado à mão o teria): o registro exige a MESMA referência nascida aqui.
 */
const ENGINE_TOOLS = new WeakSet<CopilotToolDefinition>();

/** A definição veio do motor de propostas? */
export function isEngineTool(tool: CopilotToolDefinition): boolean {
  return tool.authorization === 'engine' && ENGINE_TOOLS.has(tool);
}

/**
 * Campos que nunca podem existir em `args`, em QUALQUER profundidade: a identidade vem só
 * do grant (ADR-003 §3; COPILOTO.md §8 R2). Comparados depois de `normalizeArgKey` (sem
 * caixa, sem `_`/`-`): `member_id`, `memberId` e `Member-ID` são o mesmo campo.
 *
 * Alvos legítimos de uma ação (`owner_id`, `assignee_member_id`) continuam permitidos: o
 * que se proíbe é o campo que diria QUEM está agindo, não SOBRE QUEM.
 */
const IDENTITY_ARG_KEYS: ReadonlySet<string> = new Set(
  [
    'member_id',
    'mid',
    'workspace_id',
    'ws',
    'tenant_id',
    'user_id',
    'auth_user_id',
    'requested_by',
    'requested_by_member_id',
    'approver_member_id',
    'approved_by',
    'impersonator',
    'turn_id',
    'tid',
    'grant',
    'nonce',
  ].map(normalizeArgKey),
);

/** Prefixos proibidos (`actor`, `actor_id`, `actorMemberId`, `executed_as_member_id`…). */
const IDENTITY_ARG_PREFIXES: readonly string[] = ['actor', 'executed_as'].map(normalizeArgKey);

function normalizeArgKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isIdentityArgKey(key: string): boolean {
  const normalized = normalizeArgKey(key);
  return (
    IDENTITY_ARG_KEYS.has(normalized) ||
    IDENTITY_ARG_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

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

/** Profundidade máxima percorrida: args de ferramenta são rasos; além disso é erro. */
const ARGS_MAX_DEPTH = 16;

/** Filhos diretos de um schema (embrulhos, elementos, variantes e campos). */
function childSchemas(schema: z.ZodTypeAny): readonly z.ZodTypeAny[] {
  if (schema instanceof z.ZodObject) {
    const fields = Object.values(schema.shape as Record<string, z.ZodTypeAny>);
    const catchall: z.ZodTypeAny = schema._def.catchall;
    return catchall instanceof z.ZodNever ? fields : [...fields, catchall];
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly
  ) {
    return [schema._def.innerType];
  }
  if (schema instanceof z.ZodEffects) return [schema.innerType()];
  if (schema instanceof z.ZodBranded) return [schema.unwrap()];
  if (schema instanceof z.ZodLazy) return [schema.schema];
  if (schema instanceof z.ZodPipeline) return [schema._def.in, schema._def.out];
  if (schema instanceof z.ZodArray) return [schema.element];
  if (schema instanceof z.ZodSet) return [schema._def.valueType];
  if (schema instanceof z.ZodTuple) {
    const rest: z.ZodTypeAny | null = schema._def.rest;
    return rest ? [...schema.items, rest] : [...schema.items];
  }
  if (schema instanceof z.ZodRecord || schema instanceof z.ZodMap) {
    return [schema._def.keyType, schema._def.valueType];
  }
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
    return [...schema.options];
  }
  if (schema instanceof z.ZodIntersection) return [schema._def.left, schema._def.right];
  return [];
}

/**
 * Percorre o schema inteiro (objetos aninhados, arrays, uniões, embrulhos) e lança no
 * primeiro campo de identidade. Objetos aninhados também não podem repassar chaves
 * desconhecidas (`.passthrough()`): o handler receberia campos que o modelo inventou.
 */
function assertNoIdentityFields(
  key: string,
  schema: z.ZodTypeAny,
  path: string,
  depth: number,
  seen: Set<z.ZodTypeAny>,
): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  if (depth > ARGS_MAX_DEPTH) {
    throw new Error(`copilot tool '${key}': args profundo demais em '${path}'.`);
  }
  if (schema instanceof z.ZodObject) {
    if (schema._def.unknownKeys === 'passthrough') {
      throw new Error(`copilot tool '${key}': objeto em '${path}' não pode ser .passthrough().`);
    }
    for (const [field, child] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      const fieldPath = `${path}.${field}`;
      if (isIdentityArgKey(field)) {
        throw new Error(
          `copilot tool '${key}': campo de identidade proibido em args: '${fieldPath}'.`,
        );
      }
      assertNoIdentityFields(key, child, fieldPath, depth + 1, seen);
    }
    const catchall: z.ZodTypeAny = schema._def.catchall;
    if (!(catchall instanceof z.ZodNever)) {
      assertNoIdentityFields(key, catchall, `${path}.*`, depth + 1, seen);
    }
    return;
  }
  for (const child of childSchemas(schema)) {
    assertNoIdentityFields(key, child, path, depth + 1, seen);
  }
}

function assertSafeArgs(key: string, args: z.ZodTypeAny): void {
  const obj = innerObject(args);
  if (!obj) throw new Error(`copilot tool '${key}': args precisa ser z.object(...).strict().`);
  if (obj._def.unknownKeys !== 'strict') {
    throw new Error(`copilot tool '${key}': args precisa ser .strict() (ADR-003 §3).`);
  }
  assertNoIdentityFields(key, args, 'args', 0, new Set());
}

/**
 * Define uma ferramenta: valida as invariantes, preenche o `label` do catálogo e apaga o
 * tipo dos `args` para o registro heterogêneo. O handler continua recebendo `Args`
 * (o callback só o chama com a saída do próprio `args.safeParse`).
 */
export function defineCopilotTool<Args>(spec: CopilotToolSpec<Args>): CopilotToolDefinition {
  if (isWriteCapability(spec.capability)) {
    throw new Error(
      `copilot tool '${spec.key}': capacidade de escrita '${spec.capability}' só pelo motor de propostas (makeProposeTool).`,
    );
  }
  return buildDefinition(spec, undefined);
}

/**
 * Define uma ferramenta de ESCRITA cuja autorização é do motor de propostas. Uso exclusivo de
 * `makeProposeTool` (`services/copilot/proposals`): é o handler dele que classifica, autoriza
 * com o volume real e grava a proposta (inclusive `blocked`).
 */
export function defineEngineTool<Args>(spec: CopilotToolSpec<Args>): CopilotToolDefinition {
  if (!isWriteCapability(spec.capability)) {
    throw new Error(`copilot tool '${spec.key}': 'engine' é só para capacidade de escrita.`);
  }
  if (spec.taintsTurn) {
    throw new Error(`copilot tool '${spec.key}': propor não lê conteúdo de contato.`);
  }
  const definition = buildDefinition(spec, 'engine');
  ENGINE_TOOLS.add(definition);
  return definition;
}

function buildDefinition<Args>(
  spec: CopilotToolSpec<Args>,
  authorization: CopilotToolAuthorization | undefined,
): CopilotToolDefinition {
  const key = CopilotToolKeySchema.safeParse(spec.key);
  if (!key.success) throw new Error(`copilot tool: key inválida '${spec.key}'.`);
  assertSafeArgs(spec.key, spec.args);
  const definition: CopilotToolDefinition<Args> = {
    ...spec,
    label: statusLabelFor(spec.capability, spec.area).label,
    ...(authorization ? { authorization } : {}),
  };
  // Apagamento de tipo deliberado: `Args` só entra pelo `safeParse` do próprio schema.
  return definition as unknown as CopilotToolDefinition;
}

export interface CopilotToolRegistry {
  get(key: string): CopilotToolDefinition | undefined;
  list(): readonly CopilotToolDefinition[];
}

/**
 * Monta o registro. Lança no boot se houver chave repetida, ferramenta inválida, escrita que não
 * veio do motor de propostas ou `engine` forjado.
 */
export function createCopilotToolRegistry(
  tools: readonly CopilotToolDefinition[],
): CopilotToolRegistry {
  const byKey = new Map<string, CopilotToolDefinition>();
  for (const tool of tools) {
    if (!CopilotToolKeySchema.safeParse(tool.key).success) {
      throw new Error(`copilot tool: key inválida '${tool.key}'.`);
    }
    assertSafeArgs(tool.key, tool.args);
    if (isWriteCapability(tool.capability) && !isEngineTool(tool)) {
      throw new Error(
        `copilot tool '${tool.key}': escrita '${tool.capability}' precisa vir do makeProposeTool.`,
      );
    }
    if (tool.authorization !== undefined && !isEngineTool(tool)) {
      throw new Error(`copilot tool '${tool.key}': authorization '${tool.authorization}' forjada.`);
    }
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
 * Contexto da oferta de escritas: os papéis dos OUTROS membros ativos do workspace (quem poderia
 * aprovar). Sem ele, uma escrita só é oferecida a quem pode executá-la (falha fechada).
 */
export interface ToolOfferContext {
  readonly otherActiveRoles: ReadonlySet<Role>;
}

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

/** Uma query barata (índice de membros do workspace): papéis distintos dos outros ativos. */
export async function loadToolOfferContext(
  tx: DbTx,
  principal: Pick<CopilotPrincipal, 'workspaceId' | 'memberId'>,
): Promise<ToolOfferContext> {
  const m = schema.members;
  const rows = await tx
    .selectDistinct({ role: m.role })
    .from(m)
    .where(
      and(
        eq(m.workspaceId, principal.workspaceId),
        eq(m.status, 'active'),
        ne(m.id, principal.memberId),
      ),
    );
  const roles = new Set<Role>();
  for (const { role } of rows) {
    if (isRole(role)) roles.add(role);
  }
  return { otherActiveRoles: roles };
}

/** Algum papel ativo (fora o do membro) pode executar esta escrita e satisfaz as `requires`? */
function hasPossibleApprover(
  principal: CopilotPrincipal,
  tool: CopilotToolDefinition,
  offer: ToolOfferContext | undefined,
): boolean {
  if (!offer) return false;
  for (const role of offer.otherActiveRoles) {
    if (!capabilityAllowed(role, principal.matrix, tool.capability, 1).allowed) continue;
    if ((tool.requires ?? []).every((perm) => can(role, perm))) return true;
  }
  return false;
}

/**
 * A ferramenta é oferecida a este membro?
 *
 * Consultas: capacidade efetiva (papel ∧ matriz) e as permissões de entidade.
 *
 * Escritas (`engine`): membro ativo, Copiloto ligado e liberado para o papel (`copilot.use` ∧
 * matriz `use`), `requires` de leitura satisfeitas, a matriz NÃO desligou a capacidade para o
 * papel, e (o papel pode executar OU existe ao menos um aprovador possível). Papel, assinatura e
 * `queries_only` NÃO escondem a escrita: o motor recusa com o volume real e grava `blocked` com
 * o motivo e o "Pedir aprovação" (ADR-003 §5 e §7).
 */
export function toolOfferedTo(
  principal: CopilotPrincipal,
  tool: CopilotToolDefinition,
  offer?: ToolOfferContext,
): boolean {
  if (principal.memberStatus !== 'active' || !principal.settings.enabled) return false;
  if (!(tool.requires ?? []).every((perm) => can(principal.role, perm))) return false;
  if (!isWriteCapability(tool.capability)) {
    return principal.effectiveCapabilities[tool.capability].allowed;
  }
  if (!isEngineTool(tool)) return false;
  if (!copilotAccessFor(principal.role, principal.matrix).allowed) return false;
  if (principal.matrix[principal.role]?.[tool.capability] === false) return false;
  return (
    principal.effectiveCapabilities[tool.capability].allowed ||
    hasPossibleApprover(principal, tool, offer)
  );
}

/**
 * Ferramentas que o modelo vê neste turno. O que o membro não pode usar não aparece. Passe o
 * `loadToolOfferContext` para oferecer escritas a quem pode pedir aprovação.
 */
export function listToolDescriptorsFor(
  principal: CopilotPrincipal,
  tools: readonly CopilotToolDefinition[],
  offer?: ToolOfferContext,
): CopilotToolDescriptor[] {
  return tools
    .filter((tool) => toolOfferedTo(principal, tool, offer))
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
