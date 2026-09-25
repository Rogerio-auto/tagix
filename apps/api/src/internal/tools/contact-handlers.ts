/**
 * Tools de contato do agente (F70-S15) — `add_contact_tag` e `update_contact`.
 *
 * Rodam no endpoint interno (`POST /internal/tools/:key`), DENTRO de
 * `withWorkspace` (RLS) e só depois da barreira de habilitação (`access.ts`).
 *
 * Alvo: SEMPRE o contato da conversa do envelope (`conversations.contact_id`, sob
 * RLS). O modelo não escolhe qual contato edita — não existe `contact_id` nos args.
 *
 * `add_contact_tag` — só aplica etiqueta que JÁ EXISTE no workspace. O modelo não
 * cria etiquetas. Motivo: etiqueta aqui é controle, não enfeite — `atendimento-humano`
 * pausa a cadência, `tag_added` dispara flows e o trigger de conversão reage ao INSERT
 * em `contact_tags`. Deixar o modelo cunhar nomes abriria a taxonomia a lixo, a
 * variações que escapam das regras ("Atendimento Humano") e a gatilhos inesperados.
 * Mesmo comportamento do nó `add_tag` do flow-engine (resolve por nome, não cria).
 *
 * `update_contact` — allowlist estrita (`.strict()`): nome de exibição, idioma, fuso e
 * campos personalizados (merge, chaves e valores limitados). Fora dela, por decisão:
 * telefone e e-mail (identidade de canal / dedup / consentimento), dono, workspace,
 * consentimento/opt-in/opt-out, documento, endereço, notas internas e atribuição de
 * anúncio. Campo fora da lista → recusa sem escrever nada.
 */
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { DbTx } from '@hm/db';
import type { ToolCallEnvelope, ToolHandler, ToolHandlerResult } from './registry';

const { contacts, contactTags, conversations, tags } = schema;

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

// ─── add_contact_tag ─────────────────────────────────────────────────────────

export const addContactTagArgs = z
  .object({
    tag: z.string().trim().min(1).max(80),
  })
  .strict();

/**
 * Resolve a etiqueta pelo nome: igualdade exata primeiro; senão, sem diferenciar
 * maiúsculas, desde que o resultado seja único (duas etiquetas que só diferem na
 * caixa são ambíguas → não aplica nenhuma).
 */
async function resolveTag(tx: DbTx, workspaceId: string, name: string): Promise<string | null> {
  const [exact] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), eq(tags.name, name)))
    .limit(1);
  if (exact) return exact.id;
  const folded = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), sql`lower(${tags.name}) = lower(${name})`))
    .limit(2);
  return folded.length === 1 ? (folded[0]?.id ?? null) : null;
}

export const addContactTag: ToolHandler = async (env, tx) => {
  const parsed = addContactTagArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para add_contact_tag.');

  const contactId = await conversationContact(tx, env);
  if (contactId === null) return fail('Não há contato associado a esta conversa.');

  const tagId = await resolveTag(tx, env.workspaceId, parsed.data.tag);
  if (tagId === null) {
    return fail(
      `A etiqueta '${parsed.data.tag}' não existe neste workspace. Use apenas etiquetas já cadastradas.`,
    );
  }

  const inserted = await tx
    .insert(contactTags)
    .values({ contactId, tagId, workspaceId: env.workspaceId })
    .onConflictDoNothing()
    .returning({ tagId: contactTags.tagId });

  const applied = inserted.length > 0;
  return {
    ok: true,
    content: applied
      ? `Etiqueta '${parsed.data.tag}' aplicada ao contato.`
      : `O contato já tinha a etiqueta '${parsed.data.tag}'.`,
    action: 'add_contact_tag',
    tableName: 'contact_tags',
    payload: { tagId, applied },
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

const CUSTOM_FIELD_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const CUSTOM_FIELDS_MAX_KEYS = 20;
const CUSTOM_FIELD_VALUE_MAX = 500;

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
    display_name: z.string().trim().min(1).max(200).optional(),
    // BCP 47 simples (pt, pt-BR, es-419): o suficiente para idioma de atendimento.
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(-([A-Z]{2}|[0-9]{3}))?$/)
      .optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isIanaTimeZone, 'fuso IANA inválido')
      .optional(),
    custom_fields: z
      .record(z.string().regex(CUSTOM_FIELD_KEY), customFieldValue)
      .refine((v) => Object.keys(v).length <= CUSTOM_FIELDS_MAX_KEYS, 'campos demais')
      .optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nenhum campo informado');

/** Chaves de `args` fora da allowlist (para a mensagem de recusa; nunca os valores). */
function disallowedKeys(args: Record<string, unknown>): string[] {
  const allowed = new Set<string>(UPDATE_CONTACT_EDITABLE_FIELDS);
  return Object.keys(args)
    .filter((k) => !allowed.has(k))
    .map((k) => k.slice(0, 64))
    .sort();
}

export const updateContact: ToolHandler = async (env, tx) => {
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

  const contactId = await conversationContact(tx, env);
  if (contactId === null) return fail('Não há contato associado a esta conversa.');

  const d = parsed.data;
  const updated = await tx
    .update(contacts)
    .set({
      ...(d.display_name !== undefined ? { displayName: d.display_name } : {}),
      ...(d.language !== undefined ? { language: d.language } : {}),
      ...(d.timezone !== undefined ? { timezone: d.timezone } : {}),
      // Merge (não substitui): o modelo só mexe nas chaves que mandou.
      ...(d.custom_fields !== undefined
        ? {
            customFields: sql`coalesce(${contacts.customFields}, '{}'::jsonb) || ${JSON.stringify(d.custom_fields)}::jsonb`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .returning({ id: contacts.id });
  if (updated.length === 0) return fail('Contato não encontrado.');

  const changed = UPDATE_CONTACT_EDITABLE_FIELDS.filter((f) => d[f] !== undefined);
  return {
    ok: true,
    content: `Contato atualizado (${changed.join(', ')}).`,
    action: 'update_contact',
    tableName: 'contacts',
    payload: { updated: changed },
  };
};
