/**
 * Editar os campos de um contato que uma IA pode tocar (F73-S08).
 *
 * A allowlist é a MESMA do agente de atendimento (`UPDATE_CONTACT_EDITABLE_FIELDS`, por import):
 * nome de exibição, idioma, fuso e campos personalizados. Telefone, e-mail, documento,
 * endereço, dono e consentimento ficam fora (são decisões da tela ou do próprio contato).
 *
 * `custom_fields` é MESCLADO (só as chaves enviadas mudam). Para restaurar (desfazer), uma
 * chave com `undefined` em `customFieldsRemove` sai do objeto: era o estado de antes.
 *
 * Devolve o antes e o depois SÓ dos campos tocados (é o que a prévia e o desfazer comparam).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { UPDATE_CONTACT_EDITABLE_FIELDS } from '../../internal/tools/contact-handlers';

const { contacts } = schema;

export { UPDATE_CONTACT_EDITABLE_FIELDS };
export type ContactEditableField = (typeof UPDATE_CONTACT_EDITABLE_FIELDS)[number];

/** Valor de campo personalizado aceito (o mesmo do agente). */
export type CustomFieldValue = string | number | boolean | null;

/** Patch dos campos editáveis. `undefined` = não mexe; `null` = limpa. */
export interface ContactFieldsPatch {
  readonly display_name?: string | null;
  readonly language?: string | null;
  readonly timezone?: string | null;
  /** Chaves a gravar (mescla). */
  readonly custom_fields?: Readonly<Record<string, CustomFieldValue>>;
  /** Chaves a REMOVER de `custom_fields` (restaurar "não existia"). */
  readonly custom_fields_remove?: readonly string[];
}

/**
 * Estado dos campos tocados. Em `custom_fields`, chave ausente do contato = `undefined` não
 * serializa; por isso a lista `custom_fields_absent` diz quais não existiam.
 */
export interface ContactFieldsSnapshot {
  display_name?: string | null;
  language?: string | null;
  timezone?: string | null;
  custom_fields?: Record<string, unknown>;
  custom_fields_absent?: string[];
}

type ContactRow = typeof contacts.$inferSelect;

/** Fotografa os campos que o patch toca (o "antes" e o "depois" campo a campo). */
export function snapshotContactFields(
  row: Pick<ContactRow, 'displayName' | 'language' | 'timezone' | 'customFields'>,
  patch: ContactFieldsPatch,
): ContactFieldsSnapshot {
  const out: ContactFieldsSnapshot = {};
  if (patch.display_name !== undefined) out.display_name = row.displayName;
  if (patch.language !== undefined) out.language = row.language;
  if (patch.timezone !== undefined) out.timezone = row.timezone;
  const keys = [...Object.keys(patch.custom_fields ?? {}), ...(patch.custom_fields_remove ?? [])];
  if (keys.length > 0) {
    const current = row.customFields ?? {};
    const values: Record<string, unknown> = {};
    const absent: string[] = [];
    for (const key of [...new Set(keys)].sort()) {
      if (Object.prototype.hasOwnProperty.call(current, key)) values[key] = current[key];
      else absent.push(key);
    }
    out.custom_fields = values;
    if (absent.length > 0) out.custom_fields_absent = absent;
  }
  return out;
}

/** Patch que devolve o contato ao `snapshot` (desfazer). */
export function patchFromSnapshot(snapshot: ContactFieldsSnapshot): ContactFieldsPatch {
  const custom: Record<string, CustomFieldValue> = {};
  for (const [k, v] of Object.entries(snapshot.custom_fields ?? {})) {
    custom[k] =
      typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null
        ? v
        : null;
  }
  return {
    ...(snapshot.display_name !== undefined ? { display_name: snapshot.display_name } : {}),
    ...(snapshot.language !== undefined ? { language: snapshot.language } : {}),
    ...(snapshot.timezone !== undefined ? { timezone: snapshot.timezone } : {}),
    ...(Object.keys(custom).length > 0 ? { custom_fields: custom } : {}),
    ...(snapshot.custom_fields_absent?.length
      ? { custom_fields_remove: snapshot.custom_fields_absent }
      : {}),
  };
}

export interface UpdateContactFieldsResult {
  readonly contact: ContactRow;
  readonly before: ContactFieldsSnapshot;
  readonly after: ContactFieldsSnapshot;
}

/**
 * Aplica o patch num contato (não excluído) da transação RLS do chamador. `null` = contato
 * inexistente/invisível. Trava a linha (`FOR UPDATE`) para que o antes lido seja o que muda.
 */
export async function updateContactFields(
  tx: DbTx,
  input: { readonly contactId: string; readonly patch: ContactFieldsPatch },
): Promise<UpdateContactFieldsResult | null> {
  const { patch } = input;
  const [current] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), isNull(contacts.deletedAt)))
    .limit(1)
    .for('update');
  if (!current) return null;
  const before = snapshotContactFields(current, patch);

  const merge = patch.custom_fields ?? {};
  const remove = patch.custom_fields_remove ?? [];
  const touchesCustom = Object.keys(merge).length > 0 || remove.length > 0;
  let customExpr = sql`coalesce(${contacts.customFields}, '{}'::jsonb)`;
  for (const key of remove) customExpr = sql`(${customExpr} - ${key}::text)`;
  if (Object.keys(merge).length > 0) {
    customExpr = sql`(${customExpr} || ${JSON.stringify(merge)}::jsonb)`;
  }

  const [updated] = await tx
    .update(contacts)
    .set({
      ...(patch.display_name !== undefined ? { displayName: patch.display_name } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(touchesCustom ? { customFields: customExpr } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.id, input.contactId), isNull(contacts.deletedAt)))
    .returning();
  if (!updated) return null;
  return { contact: updated, before, after: snapshotContactFields(updated, patch) };
}
