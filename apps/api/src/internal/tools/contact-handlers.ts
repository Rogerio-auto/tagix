/**
 * Tools de contato do agente (F70-S15, endurecidas na F70-S23) — `add_contact_tag` e
 * `update_contact`.
 *
 * Rodam no endpoint interno (`POST /internal/tools/:key`), DENTRO de
 * `withWorkspace` (RLS) e só depois da barreira de habilitação (`access.ts`).
 *
 * Alvo: SEMPRE o contato da conversa do envelope (`conversations.contact_id`, sob
 * RLS). O modelo não escolhe qual contato edita — não existe `contact_id` nos args.
 *
 * ## O que o modelo pode escrever: allowlist do operador (F70-S23)
 *
 * Etiqueta e campo personalizado são controle, não enfeite: `atendimento-humano` pausa
 * a cadência, `tag_added` dispara flows, e o trigger `fn_contact_tags_register_conversion`
 * (0027) registra conversão no INSERT de uma etiqueta mapeada em `conversion_tag_triggers`.
 * Por isso a escrita é NEGADA por padrão e liberada item a item pelo operador:
 *
 *  - `add_contact_tag` → `allowed_tags`: nomes EXATOS das etiquetas que este agente pode
 *    aplicar;
 *  - `update_contact` → `custom_fields_write_keys`: chaves de `custom_fields` que este
 *    agente pode gravar. `display_name`, `language` e `timezone` seguem liberados pela
 *    habilitação da tool.
 *
 * **Onde o operador configura** (a UI ainda não existe; hoje é dado no banco):
 *  - por agente: `agent_tools.overrides` do vínculo agente ↔ tool, ex.
 *    `{"allowed_tags": ["atendimento-humano"]}`;
 *  - teto do workspace (opcional): uma tool custom do workspace com a mesma key
 *    (`tools.workspace_id = <ws>`, que vence a global) com a lista em `handler_config`.
 *
 * Regra de resolução (`resolveWriteAllowlist`), sempre lida do BANCO pela barreira e
 * nunca do request:
 *  1. o override do agente, se declarado; senão, a lista de `handler_config`; senão, `[]`;
 *  2. se `handler_config` declara a lista, ela é TETO: o override só escolhe dentro dela
 *     (interseção). Override não amplia o que o operador fixou para o workspace;
 *  3. valor com formato inválido vale como `[]` (fail-closed).
 * O catálogo global não declara as listas: sem configuração, nada é liberado.
 *
 * Etiqueta de conversão (mapeada em `conversion_tag_triggers`): mesmo na allowlist, só é
 * aplicada se o agente pode registrar conversões — `workspace_agent_policies.
 * allow_agent_conversions` ligado E a tool `register_conversion` habilitada para ele.
 * Sem isso a etiqueta seria o atalho para a conversão que a política proíbe.
 *
 * `update_contact` — allowlist estrita (`.strict()`): nome de exibição, idioma, fuso e
 * campos personalizados (merge). Fora dela, por decisão: telefone e e-mail (identidade
 * de canal / dedup / consentimento), dono, workspace, consentimento/opt-in/opt-out,
 * documento, endereço, notas internas e atribuição de anúncio. Campo fora da lista →
 * recusa sem escrever nada.
 *
 * `display_name` volta ao prompt do agente em todo turno (L-f): sem quebra de linha,
 * sem colchetes/chaves/sinais de delimitação, sem caractere de controle ou invisível, e
 * no máximo 80 caracteres. Fora disso, recusa (não "conserta" o nome).
 *
 * `null` nos args (L-g): o catálogo declara os campos como `["tipo","null"]`; aqui `null`
 * significa "não informado" e não escreve nada, igual a omitir o campo.
 *
 * Mensagens de erro vão para `tool_logs.error`: nunca repetem valor vindo do modelo.
 */
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { DbTx } from '@hm/db';
import { isToolEnabledForAgent } from './access';
import type {
  ToolCallEnvelope,
  ToolConfigSnapshot,
  ToolHandler,
  ToolHandlerResult,
} from './registry';

const { contacts, contactTags, conversionTagTriggers, conversations, tags } = schema;

function fail(error: string): ToolHandlerResult {
  return { ok: false, error };
}

/** Contato (não apagado) da conversa do envelope, sob RLS. `null` se não houver. */
async function conversationContact(tx: DbTx, env: ToolCallEnvelope): Promise<string | null> {
  if (env.conversationId === null) return null;
  const [row] = await tx
    .select({ contactId: contacts.id })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(conversations.id, env.conversationId), isNull(contacts.deletedAt)))
    .limit(1);
  return row?.contactId ?? null;
}

// ─── Allowlists de escrita ───────────────────────────────────────────────────

/** Chave da allowlist de etiquetas em `handler_config`/`overrides`. */
export const ALLOWED_TAGS_KEY = 'allowed_tags';
/** Chave da allowlist de campos personalizados em `handler_config`/`overrides`. */
export const CUSTOM_FIELDS_WRITE_KEYS_KEY = 'custom_fields_write_keys';

const ALLOWLIST_MAX = 200;
const TAG_NAME_MAX = 80;
const CUSTOM_FIELD_KEY = /^[a-z][a-z0-9_]{0,63}$/;

const tagNameItem = z.string().min(1).max(TAG_NAME_MAX);
const customFieldKeyItem = z.string().regex(CUSTOM_FIELD_KEY);

/** Lista declarada na config: `undefined` se ausente; formato inválido → `[]`. */
function declaredList(value: unknown, item: z.ZodType<string>): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const parsed = z.array(item).max(ALLOWLIST_MAX).safeParse(value);
  return parsed.success ? [...new Set(parsed.data)] : [];
}

/**
 * Allowlist efetiva de `key` para este agente (regra no cabeçalho): override do agente
 * dentro do teto do `handler_config`; nada declarado → `[]`.
 */
export function resolveWriteAllowlist(
  config: ToolConfigSnapshot,
  key: string,
  item: z.ZodType<string>,
): readonly string[] {
  const ceiling = declaredList(config.base[key], item);
  const override = declaredList(config.overrides[key], item);
  const grant = override ?? ceiling ?? [];
  if (ceiling === undefined) return grant;
  const inCeiling = new Set(ceiling);
  return grant.filter((v) => inCeiling.has(v));
}

export function allowedTagsOf(config: ToolConfigSnapshot): readonly string[] {
  return resolveWriteAllowlist(config, ALLOWED_TAGS_KEY, tagNameItem);
}

export function customFieldsWriteKeysOf(config: ToolConfigSnapshot): readonly string[] {
  return resolveWriteAllowlist(config, CUSTOM_FIELDS_WRITE_KEYS_KEY, customFieldKeyItem);
}

/** Lista para mensagem ao modelo (vocabulário do operador), com teto de tamanho. */
function listForModel(values: readonly string[]): string {
  const shown = values.slice(0, 20).join(', ');
  return values.length > 20 ? `${shown} (+${values.length - 20})` : shown;
}

// ─── add_contact_tag ─────────────────────────────────────────────────────────

export const addContactTagArgs = z
  .object({
    tag: z.string().trim().min(1).max(TAG_NAME_MAX),
  })
  .strict();

/**
 * Resolve a etiqueta pelo nome: igualdade exata primeiro; senão, sem diferenciar
 * maiúsculas, desde que o resultado seja único (duas etiquetas que só diferem na
 * caixa são ambíguas → não aplica nenhuma). Devolve o nome GRAVADO, que é o que a
 * allowlist compara.
 */
async function resolveTag(
  tx: DbTx,
  workspaceId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const [exact] = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), eq(tags.name, name)))
    .limit(1);
  if (exact) return exact;
  const folded = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), sql`lower(${tags.name}) = lower(${name})`))
    .limit(2);
  return folded.length === 1 ? (folded[0] ?? null) : null;
}

/** A etiqueta registra conversão (trigger da 0027) neste workspace? */
async function isConversionTag(tx: DbTx, workspaceId: string, tagId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: conversionTagTriggers.id })
    .from(conversionTagTriggers)
    .where(
      and(
        eq(conversionTagTriggers.workspaceId, workspaceId),
        eq(conversionTagTriggers.tagId, tagId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * O agente pode registrar conversões: política do workspace ligada E `register_conversion`
 * habilitada para ele (a mesma resolução da barreira).
 */
async function agentMayRegisterConversions(tx: DbTx, env: ToolCallEnvelope): Promise<boolean> {
  const [policy] = await tx
    .select({ allow: schema.workspaceAgentPolicies.allowAgentConversions })
    .from(schema.workspaceAgentPolicies)
    .where(eq(schema.workspaceAgentPolicies.workspaceId, env.workspaceId))
    .limit(1);
  if (policy?.allow !== true) return false;
  return isToolEnabledForAgent(tx, env, 'register_conversion');
}

export const addContactTag: ToolHandler = async (env, tx, ctx) => {
  const parsed = addContactTagArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para add_contact_tag.');

  // Negação por padrão: sem allowlist, nem consulta o banco.
  const allowed = allowedTagsOf(ctx.toolConfig);
  if (allowed.length === 0) return fail('Nenhuma etiqueta está liberada para este agente.');

  const contactId = await conversationContact(tx, env);
  if (contactId === null) return fail('Não há contato associado a esta conversa.');

  // "Não existe" e "não liberada" respondem igual: o que importa ao modelo é a lista.
  const tag = await resolveTag(tx, env.workspaceId, parsed.data.tag);
  if (tag === null || !allowed.includes(tag.name)) {
    return fail(
      `Etiqueta não liberada para este agente. Etiquetas liberadas: ${listForModel(allowed)}.`,
    );
  }

  if (
    (await isConversionTag(tx, env.workspaceId, tag.id)) &&
    !(await agentMayRegisterConversions(tx, env))
  ) {
    return fail(
      'Esta etiqueta registra uma conversão, e este agente não tem permissão para registrar conversões.',
    );
  }

  const inserted = await tx
    .insert(contactTags)
    .values({ contactId, tagId: tag.id, workspaceId: env.workspaceId })
    .onConflictDoNothing()
    .returning({ tagId: contactTags.tagId });

  const applied = inserted.length > 0;
  return {
    ok: true,
    content: applied
      ? `Etiqueta '${tag.name}' aplicada ao contato.`
      : `O contato já tinha a etiqueta '${tag.name}'.`,
    action: 'add_contact_tag',
    tableName: 'contact_tags',
    payload: { tagId: tag.id, applied },
  };
};

// ─── update_contact ──────────────────────────────────────────────────────────

/** Campos que o modelo pode editar. Qualquer outro é recusado. */
export const UPDATE_CONTACT_EDITABLE_FIELDS = [
  'display_name',
  'language',
  'timezone',
  'custom_fields',
] as const;

const CUSTOM_FIELDS_MAX_KEYS = 20;
const CUSTOM_FIELD_VALUE_MAX = 500;
/** Teto do nome de exibição (L-f): ele volta ao prompt em todo turno. */
export const DISPLAY_NAME_MAX = 80;
/**
 * Proibido no nome de exibição: controle e formatação invisível (`Cc`/`Cf`, inclui
 * quebra de linha, tab e zero-width), separadores de linha/parágrafo, e os sinais que
 * delimitam blocos no prompt (`[]`, `{}`, `<>`, `⟦⟧`).
 */
const DISPLAY_NAME_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}[\]{}<>⟦⟧]/u;

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const customFieldValue = z.union([
  z.string().max(CUSTOM_FIELD_VALUE_MAX),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const updateContactArgs = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(1)
      .max(DISPLAY_NAME_MAX)
      .refine((v) => !DISPLAY_NAME_FORBIDDEN.test(v), 'caractere não permitido')
      .nullish(),
    // BCP 47 simples (pt, pt-BR, es-419): o suficiente para idioma de atendimento.
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(-([A-Z]{2}|[0-9]{3}))?$/)
      .nullish(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isIanaTimeZone, 'fuso IANA inválido')
      .nullish(),
    custom_fields: z
      .record(z.string().regex(CUSTOM_FIELD_KEY), customFieldValue)
      .refine((v) => Object.keys(v).length <= CUSTOM_FIELDS_MAX_KEYS, 'campos demais')
      .nullish(),
  })
  .strict()
  .refine(
    (v) => Object.values(v).some((x) => x !== undefined && x !== null),
    'nenhum campo informado',
  );

/** Chaves de `args` fora da allowlist (para a mensagem de recusa; nunca os valores). */
function disallowedKeys(args: Record<string, unknown>): string[] {
  const allowed = new Set<string>(UPDATE_CONTACT_EDITABLE_FIELDS);
  return Object.keys(args)
    .filter((k) => !allowed.has(k))
    .map((k) => k.slice(0, 64).replace(/\d/g, '#'))
    .sort();
}

export const updateContact: ToolHandler = async (env, tx, ctx) => {
  const rejected = disallowedKeys(env.args);
  if (rejected.length > 0) {
    return fail(
      `Campo(s) não editável(is) pelo agente: ${rejected.join(', ')}. ` +
        `Permitidos: ${UPDATE_CONTACT_EDITABLE_FIELDS.join(', ')}.`,
    );
  }
  const parsed = updateContactArgs.safeParse(env.args);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'args')))];
    return fail(`Valor inválido para update_contact: ${fields.join(', ')}.`);
  }

  const d = parsed.data;
  // Campos personalizados: cada chave tem de estar liberada para este agente. Uma fora
  // da lista recusa a chamada inteira (nada é gravado, nem os campos fixos).
  if (d.custom_fields != null) {
    const writable = customFieldsWriteKeysOf(ctx.toolConfig);
    const allowedKeys = new Set(writable);
    const refused = Object.keys(d.custom_fields).filter((k) => !allowedKeys.has(k));
    if (refused.length > 0) {
      return fail(
        writable.length === 0
          ? 'Nenhum campo personalizado está liberado para escrita por este agente.'
          : `${refused.length} campo(s) personalizado(s) não liberado(s) para este agente. ` +
              `Campos liberados: ${listForModel(writable)}.`,
      );
    }
  }

  const contactId = await conversationContact(tx, env);
  if (contactId === null) return fail('Não há contato associado a esta conversa.');

  const updated = await tx
    .update(contacts)
    .set({
      ...(d.display_name != null ? { displayName: d.display_name } : {}),
      ...(d.language != null ? { language: d.language } : {}),
      ...(d.timezone != null ? { timezone: d.timezone } : {}),
      // Merge (não substitui): o modelo só mexe nas chaves que mandou.
      ...(d.custom_fields != null
        ? {
            customFields: sql`coalesce(${contacts.customFields}, '{}'::jsonb) || ${JSON.stringify(d.custom_fields)}::jsonb`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .returning({ id: contacts.id });
  if (updated.length === 0) return fail('Contato não encontrado.');

  const changed = UPDATE_CONTACT_EDITABLE_FIELDS.filter((f) => d[f] != null);
  return {
    ok: true,
    content: `Contato atualizado (${changed.join(', ')}).`,
    action: 'update_contact',
    tableName: 'contacts',
    payload: { updated: changed },
  };
};
