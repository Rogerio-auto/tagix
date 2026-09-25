/**
 * Catálogo GLOBAL das tools de agente que já têm executor (F70-S10).
 *
 * Complementa `calendar_tools.ts` (F7-S04) com as tools de **workflow**, **knowledge**
 * e **database**. Só entra aqui tool com handler real:
 *
 *  - `workflow` → callback Node `POST /internal/tools/:key`
 *    (`apps/api/src/internal/tools/workflow-handlers.ts` + `agent-transfer-handlers.ts`).
 *  - `knowledge` / `database` → executadas no próprio runtime Python, sob RLS
 *    (`apps/agent-runtime/app/tools/database/*`).
 *
 * `name`/`description` espelham as classes `Tool` do runtime (o que o modelo vê é o
 * spec do runtime; o catálogo é o que o operador vê ao habilitar a tool no agente).
 * `schema` é o function-spec OpenAI equivalente ao `Args` Pydantic de cada tool.
 * `handler_config` das tools `database` espelha o `default_handler_config` do runtime
 * (ACL de coluna deny-by-default — DATA_MODEL §7.5); o runtime aplica sempre o
 * baseline `ALWAYS_DENIED` por cima.
 *
 * Duas portas de entrada, mesmo conteúdo:
 *  - migrations de catálogo (`AGENT_TOOL_MIGRATIONS`: 0084 com as 11 da F70-S10, 0087
 *    com as tools de contato da F70-S15) — inserem o que falta (produção);
 *  - `seedAgentTools` (upsert por `key` entre as globais — sincroniza nome/descrição/
 *    schema/config em re-execuções do seed).
 * `tools_agent.test.ts` trava a divergência entre as duas.
 *
 * `add_contact_tag` / `update_contact` (F70-S15) são `workflow`: o efeito roda no Node
 * (`apps/api/src/internal/tools/contact-handlers.ts`) sobre o contato da conversa.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '../client';
import { tools } from '../schema';

export type AgentToolCategory = 'workflow' | 'knowledge' | 'database';

export interface AgentToolSeed {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: AgentToolCategory;
  readonly schema: Record<string, unknown>;
  readonly handlerConfig: Record<string, unknown>;
}

function fn(
  key: string,
  description: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return { type: 'function', function: { name: key, description, parameters } };
}

/** ACL de leitura (sem escrita) de uma tool `database` — espelho do runtime. */
function readOnlyAcl(
  table: string,
  read: readonly string[],
  restricted: readonly string[],
): Record<string, unknown> {
  return {
    table,
    allowed_columns: { read: [...read], write: [] },
    restricted_columns: [...restricted],
    required_columns: [],
  };
}

// F70-S15 (M1): sem telefone/e-mail na leitura padrão — o runtime ainda os aceita
// como teto, liberados por agente em `agent_tools.overrides`. `custom_fields` só sai
// com as chaves de `custom_fields_keys` (default: nenhuma).
const CONTACT_READ = ['display_name', 'language', 'source', 'custom_fields'];
const DEAL_READ = [
  'id',
  'title',
  'stage_id',
  'pipeline_id',
  'value_cents',
  'currency',
  'source',
  'custom_fields',
];
const CONVERSATION_READ = ['status', 'ai_mode', 'assigned_to', 'department_id', 'kind'];

export const AGENT_TOOLS: readonly AgentToolSeed[] = [
  // ─── workflow (callback Node) ─────────────────────────────────────────────
  {
    key: 'transfer_to_human',
    name: 'Transferir para humano',
    description:
      'Tira o agente de IA da conversa e a entrega a um atendente humano. Use quando o cliente pede explicitamente falar com uma pessoa, ou quando o pedido está fora da sua capacidade. Após transferir, não responda mais.',
    category: 'workflow',
    schema: fn('transfer_to_human', 'Entrega a conversa a um atendente humano.', {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          description: 'Motivo da transferência, em uma frase (registrado para o atendente).',
        },
        department_id: {
          type: ['string', 'null'],
          description: 'ID do departamento de destino. Omitir deixa o roteamento ao sistema.',
        },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  {
    key: 'transfer_to_agent',
    name: 'Transferir para outro agente de IA',
    description:
      'Passa a conversa para OUTRO agente de IA especializado (um dos pares do seu departamento listados no prompt). Após transferir, NÃO responda mais — o outro agente assume a partir daqui.',
    category: 'workflow',
    schema: fn('transfer_to_agent', 'Transfere a conversa para outro agente de IA.', {
      type: 'object',
      required: ['targetAgentId'],
      properties: {
        targetAgentId: {
          type: 'string',
          description: 'ID (UUID) do agente de destino — um dos pares listados no prompt.',
        },
        reason: { type: ['string', 'null'], minLength: 1, maxLength: 500 },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  {
    key: 'escalate',
    name: 'Escalar para supervisor',
    description:
      'Notifica um supervisor humano sobre a conversa, sem sair do atendimento. Use para casos sensíveis (reclamação grave, risco de churn, decisão acima da sua alçada). Continue atendendo normalmente após escalar.',
    category: 'workflow',
    schema: fn('escalate', 'Sinaliza a conversa para um supervisor.', {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: { type: 'string', minLength: 1, maxLength: 500 },
        severity: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  {
    key: 'mark_resolved',
    name: 'Marcar como resolvida',
    description:
      'Fecha a conversa marcando-a como resolvida. Use somente quando o pedido do cliente foi de fato atendido e não há mais nada pendente.',
    category: 'workflow',
    schema: fn('mark_resolved', 'Marca a conversa como resolvida.', {
      type: 'object',
      required: ['resolution'],
      properties: {
        resolution: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  {
    key: 'change_conversation_status',
    name: 'Alterar status da conversa',
    description:
      "Altera o status da conversa (ex.: 'pending' enquanto se aguarda o cliente). Para fechar como resolvida, prefira a ferramenta de marcar como resolvida. O sistema valida a transição.",
    category: 'workflow',
    schema: fn('change_conversation_status', 'Altera o status da conversa.', {
      type: 'object',
      required: ['target_status'],
      properties: {
        target_status: { type: 'string', enum: ['open', 'pending', 'resolved', 'closed'] },
        note: { type: ['string', 'null'], maxLength: 500 },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  {
    key: 'register_conversion',
    name: 'Registrar conversão',
    description:
      "Registra uma conversão atribuída a este atendimento (venda, agendamento, lead qualificado etc.). Use somente quando a conversão de fato ocorreu. Para valor monetário, informe 'value_cents' e 'currency'.",
    category: 'workflow',
    schema: fn('register_conversion', 'Registra uma conversão da conversa.', {
      type: 'object',
      required: ['type_key'],
      properties: {
        type_key: { type: 'string', minLength: 1, maxLength: 120 },
        value_cents: { type: ['integer', 'null'], minimum: 0 },
        currency: { type: ['string', 'null'], minLength: 3, maxLength: 3 },
        note: { type: ['string', 'null'], maxLength: 500 },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  {
    key: 'move_deal_stage',
    name: 'Mover negócio de estágio',
    description:
      'Move o negócio (deal) do contato para outro estágio do funil. Use quando a conversa indica progresso. A validação de transição e o histórico são aplicados no servidor.',
    category: 'workflow',
    schema: fn('move_deal_stage', 'Move o deal para outro estágio do pipeline.', {
      type: 'object',
      required: ['stage_id'],
      properties: {
        stage_id: { type: 'string', minLength: 1 },
        deal_id: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  // ─── contato (callback Node, F70-S15) ─────────────────────────────────────
  {
    key: 'add_contact_tag',
    name: 'Etiquetar contato',
    description:
      "Aplica uma etiqueta já existente ao contato desta conversa (ex.: 'atendimento-humano' quando uma pessoa da equipe precisa assumir). Não cria etiquetas novas: se a etiqueta não existir, a ação é recusada.",
    category: 'workflow',
    schema: fn('add_contact_tag', 'Aplica uma etiqueta existente ao contato da conversa.', {
      type: 'object',
      required: ['tag'],
      properties: {
        tag: {
          type: 'string',
          minLength: 1,
          maxLength: 80,
          description: 'Nome exato de uma etiqueta que já existe no workspace.',
        },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  {
    key: 'update_contact',
    name: 'Atualizar contato',
    description:
      'Atualiza dados do contato desta conversa: nome de exibição, idioma, fuso horário e campos personalizados. Telefone, e-mail e consentimento NÃO podem ser alterados por aqui.',
    category: 'workflow',
    schema: fn('update_contact', 'Atualiza campos permitidos do contato da conversa.', {
      type: 'object',
      properties: {
        display_name: { type: ['string', 'null'], minLength: 1, maxLength: 200 },
        language: {
          type: ['string', 'null'],
          pattern: '^[a-z]{2,3}(-([A-Z]{2}|[0-9]{3}))?$',
          description: "Idioma preferido (BCP 47, ex.: 'pt-BR').",
        },
        timezone: {
          type: ['string', 'null'],
          minLength: 1,
          maxLength: 64,
          description: "Fuso IANA (ex.: 'America/Sao_Paulo').",
        },
        custom_fields: {
          type: ['object', 'null'],
          maxProperties: 20,
          propertyNames: { pattern: '^[a-z][a-z0-9_]{0,63}$' },
          additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
          description: 'Campos personalizados (merge: só as chaves informadas mudam).',
        },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  // ─── knowledge (runtime, RLS) ─────────────────────────────────────────────
  {
    key: 'search_knowledge_base',
    name: 'Buscar na base de conhecimento',
    description:
      'Busca trechos relevantes na base de conhecimento do workspace (RAG). Use antes de responder sobre produtos/políticas.',
    category: 'knowledge',
    schema: fn('search_knowledge_base', 'Busca trechos na base de conhecimento.', {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Pergunta/consulta em linguagem natural.' },
        k: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
      },
      additionalProperties: false,
    }),
    handlerConfig: {},
  },
  // ─── database (runtime, RLS + ACL de coluna) ──────────────────────────────
  {
    key: 'query_contact',
    name: 'Consultar contato',
    description:
      'Lê dados do contato atual da conversa (nome, idioma, origem e os campos personalizados liberados para este agente).',
    category: 'database',
    schema: fn('query_contact', 'Lê dados do contato atual.', {
      type: 'object',
      properties: {
        fields: { type: 'array', items: { type: 'string' }, default: CONTACT_READ },
      },
      additionalProperties: false,
    }),
    handlerConfig: { ...readOnlyAcl('contacts', CONTACT_READ, ['notes']), custom_fields_keys: [] },
  },
  {
    key: 'query_deal',
    name: 'Consultar negócio (deal)',
    description:
      'Lê o negócio (deal) aberto do contato atual: estágio, valor, pipeline e campos personalizados.',
    category: 'database',
    schema: fn('query_deal', 'Lê o deal aberto do contato atual.', {
      type: 'object',
      properties: {
        fields: { type: 'array', items: { type: 'string' }, default: DEAL_READ },
      },
      additionalProperties: false,
    }),
    handlerConfig: readOnlyAcl('deals', DEAL_READ, ['notes']),
  },
  {
    key: 'query_conversation',
    name: 'Consultar conversa',
    description: 'Lê o estado da conversa atual (status, modo IA, atribuição, departamento).',
    category: 'database',
    schema: fn('query_conversation', 'Lê o estado da conversa atual.', {
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
    handlerConfig: readOnlyAcl('conversations', CONVERSATION_READ, []),
  },
];

/** Seeda (upsert por key, entre as globais) as tools de agente. Idempotente. */
export async function seedAgentTools(db: DB): Promise<void> {
  for (const t of AGENT_TOOLS) {
    const [existing] = await db
      .select({ id: tools.id })
      .from(tools)
      .where(and(eq(tools.key, t.key), isNull(tools.workspaceId)))
      .limit(1);

    const values = {
      name: t.name,
      description: t.description,
      category: t.category,
      schema: t.schema,
      handlerConfig: t.handlerConfig,
      isGlobal: true,
      isActive: true,
    };

    if (existing) {
      await db
        .update(tools)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(tools.id, existing.id));
    } else {
      await db.insert(tools).values({ workspaceId: null, key: t.key, ...values });
    }
  }
}

/**
 * Migrations de catálogo: as keys que cada uma insere (`keys`) e as globais que ela
 * reescreve (`updates`). Migration aplicada nunca muda: tool nova ou mudança de
 * conteúdo entra numa migration nova, com o SQL gerado só do que ela toca.
 */
export const AGENT_TOOL_MIGRATIONS: ReadonlyArray<{
  readonly file: string;
  readonly keys: readonly string[];
  readonly updates?: readonly string[];
}> = [
  {
    file: '0084_f70_agent_tools_catalog.sql',
    keys: [
      'transfer_to_human',
      'transfer_to_agent',
      'escalate',
      'mark_resolved',
      'change_conversation_status',
      'register_conversion',
      'move_deal_stage',
      'search_knowledge_base',
      'query_contact',
      'query_deal',
      'query_conversation',
    ],
  },
  {
    file: '0087_f70_agent_contact_tools.sql',
    keys: ['add_contact_tag', 'update_contact'],
    // M1: leitura padrão sem telefone/e-mail + `custom_fields_keys` vazio.
    updates: ['query_contact'],
  },
];

const sqlLiteral = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * SQL que reescreve o conteúdo de tools GLOBAIS já existentes (nome, descrição,
 * schema e `handler_config`) a partir de `AGENT_TOOLS`. As globais são da plataforma
 * (o `seedAgentTools` já as sobrescreve); overrides por agente ficam em `agent_tools`.
 */
export function renderAgentToolsUpdateSql(keys: readonly string[]): string {
  return AGENT_TOOLS.filter((t) => keys.includes(t.key))
    .map(
      (t) =>
        `UPDATE "tools" SET "name" = ${sqlLiteral(t.name)}, "description" = ${sqlLiteral(t.description)}, "schema" = ${sqlLiteral(JSON.stringify(t.schema))}::jsonb, "handler_config" = ${sqlLiteral(JSON.stringify(t.handlerConfig))}::jsonb, "updated_at" = now()\n` +
        `WHERE "key" = ${sqlLiteral(t.key)} AND "workspace_id" IS NULL;`,
    )
    .join('\n--> statement-breakpoint\n');
}

/** Corpo SQL de uma migration de catálogo (inserts e depois updates). */
export function renderAgentToolMigrationSql(m: (typeof AGENT_TOOL_MIGRATIONS)[number]): string {
  return [renderAgentToolsInsertSql(m.keys), renderAgentToolsUpdateSql(m.updates ?? [])]
    .filter((part) => part.length > 0)
    .join('\n--> statement-breakpoint\n');
}

/**
 * SQL de migration de catálogo, derivado de `AGENT_TOOLS` (todas, ou só `keys`, na
 * ordem do catálogo): insere cada tool global que ainda não existe (o UNIQUE
 * `(workspace_id, key)` trata NULL como distinto, então `ON CONFLICT` não serve —
 * `WHERE NOT EXISTS`). Usado para gerar as migrations e pelo teste que trava a
 * divergência TS ↔ SQL.
 */
export function renderAgentToolsInsertSql(keys?: readonly string[]): string {
  const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  const selected =
    keys === undefined ? AGENT_TOOLS : AGENT_TOOLS.filter((t) => keys.includes(t.key));
  return selected
    .map(
      (t) =>
        `INSERT INTO "tools" ("workspace_id", "key", "name", "description", "category", "schema", "handler_config", "is_global", "is_active")\n` +
        `SELECT NULL, ${lit(t.key)}, ${lit(t.name)}, ${lit(t.description)}, ${lit(t.category)}, ${lit(JSON.stringify(t.schema))}::jsonb, ${lit(JSON.stringify(t.handlerConfig))}::jsonb, true, true\n` +
        `WHERE NOT EXISTS (SELECT 1 FROM "tools" WHERE "key" = ${lit(t.key)} AND "workspace_id" IS NULL);`,
    )
    .join('\n--> statement-breakpoint\n');
}
