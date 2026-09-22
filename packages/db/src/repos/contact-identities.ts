/**
 * Repositório de identidades do contato (F60-S01 — CANAIS_PLAN.md §3.2).
 *
 * Resolve `(tipo, valor) → contato` e sugere fusão quando o mesmo contato chega
 * por um identificador novo. **Não funde nada**: fundir contato errado mistura o
 * histórico de duas pessoas e não tem desfazer real. A fusão é slot próprio, com
 * confirmação humana.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DbTx } from '../client';
import {
  contactIdentities,
  type ContactIdentity,
  type ContactIdentityKind,
} from '../schema/contact_identities';

/**
 * Normalização por tipo. É o que faz o índice único valer alguma coisa:
 * `Joao@Empresa.com ` e `joao@empresa.com` precisam colidir.
 */
export function normalizeIdentity(kind: ContactIdentityKind, value: string): string {
  const v = value.trim();
  switch (kind) {
    case 'email':
      return v.toLowerCase();
    case 'phone':
      // Só dígitos. O `+` do E.164 é reconstruído na exibição; guardar com e sem
      // ele criaria duas identidades para o mesmo número.
      return v.replace(/\D/g, '');
    default:
      return v;
  }
}

export interface IdentityRef {
  readonly kind: ContactIdentityKind;
  readonly value: string;
}

export const contactIdentitiesRepo = {
  /**
   * Contato dono deste identificador, se houver.
   *
   * Devolve no máximo um: o índice único garante. Se um dia devolver mais, é
   * corrupção de dado e o chamador precisa saber — por isso lança em vez de
   * escolher o primeiro em silêncio.
   */
  async resolve(
    tx: DbTx,
    workspaceId: string,
    ref: IdentityRef,
  ): Promise<string | null> {
    const value = normalizeIdentity(ref.kind, ref.value);
    if (value.length === 0) return null;

    const rows = await tx
      .select({ contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.workspaceId, workspaceId),
          eq(contactIdentities.kind, ref.kind),
          eq(contactIdentities.value, value),
        ),
      )
      .limit(2);

    if (rows.length > 1) {
      throw new Error(
        `contact_identities corrompida: ${ref.kind}='${value}' aponta para mais de um contato ` +
          `no workspace ${workspaceId}. O índice único deveria impedir isso.`,
      );
    }
    return rows[0]?.contactId ?? null;
  },

  /** Vincula um identificador a um contato. Idempotente. */
  async attach(
    tx: DbTx,
    workspaceId: string,
    contactId: string,
    ref: IdentityRef,
    verified = false,
  ): Promise<void> {
    const value = normalizeIdentity(ref.kind, ref.value);
    if (value.length === 0) return;

    await tx
      .insert(contactIdentities)
      .values({
        workspaceId,
        contactId,
        kind: ref.kind,
        value,
        verifiedAt: verified ? new Date() : null,
      })
      .onConflictDoNothing();
  },

  async listForContact(
    tx: DbTx,
    workspaceId: string,
    contactId: string,
  ): Promise<ContactIdentity[]> {
    return tx
      .select()
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.workspaceId, workspaceId),
          eq(contactIdentities.contactId, contactId),
        ),
      );
  },

  /**
   * Sugere fusão: dado um conjunto de identificadores que chegaram juntos (ex.:
   * um formulário com e-mail e telefone), diz quais contatos distintos eles já
   * apontam.
   *
   * Mais de um id na resposta significa "provavelmente é a mesma pessoa em dois
   * cadastros" — e é aí que um humano decide. **Nunca funde.**
   */
  async suggestMerge(
    tx: DbTx,
    workspaceId: string,
    refs: readonly IdentityRef[],
  ): Promise<string[]> {
    const valores = refs
      .map((r) => normalizeIdentity(r.kind, r.value))
      .filter((v) => v.length > 0);
    if (valores.length === 0) return [];

    const rows = await tx
      .select({ contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.workspaceId, workspaceId),
          inArray(contactIdentities.value, valores),
        ),
      );

    return [...new Set(rows.map((r) => r.contactId))];
  },
};
