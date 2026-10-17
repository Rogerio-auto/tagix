/**
 * Tags de contato (F73-S08, extraído de `routes/contacts/contacts.ts`).
 *
 * Um só caminho para a tela (`POST/DELETE /api/contacts/:id/tags`) e para o Copiloto
 * (`contact.tag`). Tudo na transação RLS do chamador: a tag e o contato precisam existir no
 * workspace (RLS) e o contato não pode estar excluído. Atribuir de novo é no-op
 * (`ON CONFLICT DO NOTHING`); remover o que não existe também.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';

const { contacts, tags, contactTags } = schema;

export type AddTagsResult =
  | { readonly kind: 'no_contact' }
  | { readonly kind: 'no_tag' }
  /** Tags que ESTA chamada colocou (as que o contato já tinha não entram). */
  | { readonly kind: 'ok'; readonly added: readonly string[] };

export interface AddTagsInput {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly tagIds: readonly string[];
  /** Membro que marcou (`contact_tags.tagged_by`). */
  readonly taggedBy: string | null;
}

/** Atribui tags a um contato. Uma tag inexistente recusa a chamada inteira (`no_tag`). */
export async function addTags(tx: DbTx, input: AddTagsInput): Promise<AddTagsResult> {
  const [contact] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), isNull(contacts.deletedAt)))
    .limit(1);
  if (!contact) return { kind: 'no_contact' };

  const wanted = [...new Set(input.tagIds)];
  if (wanted.length === 0) return { kind: 'ok', added: [] };
  const found = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, wanted));
  if (found.length !== wanted.length) return { kind: 'no_tag' };

  const inserted = await tx
    .insert(contactTags)
    .values(
      wanted.map((tagId) => ({
        contactId: input.contactId,
        tagId,
        workspaceId: input.workspaceId,
        taggedBy: input.taggedBy,
      })),
    )
    .onConflictDoNothing()
    .returning({ tagId: contactTags.tagId });
  return { kind: 'ok', added: inserted.map((r) => r.tagId) };
}

/** Remove tags de um contato. Devolve as que de fato saíram. */
export async function removeTags(
  tx: DbTx,
  input: { readonly contactId: string; readonly tagIds: readonly string[] },
): Promise<string[]> {
  const ids = [...new Set(input.tagIds)];
  if (ids.length === 0) return [];
  const removed = await tx
    .delete(contactTags)
    .where(and(eq(contactTags.contactId, input.contactId), inArray(contactTags.tagId, ids)))
    .returning({ tagId: contactTags.tagId });
  return removed.map((r) => r.tagId);
}

/** Tags atuais de um contato (id + nome), em ordem de nome. */
export async function listContactTags(
  tx: DbTx,
  contactIds: readonly string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>();
  if (contactIds.length === 0) return out;
  const rows = await tx
    .select({ contactId: contactTags.contactId, id: tags.id, name: tags.name })
    .from(contactTags)
    .innerJoin(tags, eq(tags.id, contactTags.tagId))
    .where(inArray(contactTags.contactId, [...contactIds]))
    .orderBy(tags.name);
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push({ id: r.id, name: r.name });
    out.set(r.contactId, list);
  }
  return out;
}

/**
 * Tag do catálogo pelo id ou pelo nome exato (sem diferenciar maiúsculas). `null` = não existe
 * no workspace. O catálogo é curado pela tela de tags (`team.edit`): ninguém cria tag por aqui.
 */
export async function findTag(tx: DbTx, ref: string): Promise<{ id: string; name: string } | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const [row] = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(isUuid ? eq(tags.id, ref) : sql`lower(${tags.name}) = lower(${ref.trim()})`)
    .limit(1);
  return row ?? null;
}
