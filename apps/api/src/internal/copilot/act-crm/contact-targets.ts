/**
 * Alvos "contatos" das ações do Copiloto (F73-S08): por ids (até 200) ou pela MESMA busca do
 * `search_contacts` (nome, nome de perfil, e-mail; telefone com 4+ dígitos), sob `contactScope`
 * e o RLS do workspace, sem os excluídos.
 *
 * O predicado de busca repete o do `search_contacts` (`read-crm/search-contacts.ts` não o
 * exporta e não é deste slot): pendência registrada para extraí-lo para um só lugar.
 *
 * Rótulo do alvo: nome no sistema → nome do perfil → "Contato sem nome". Nunca telefone/e-mail.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { BATCH_LIMIT } from '@hm/shared';
import { z } from 'zod';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import { contactScope } from '../../../services/copilot/identity/scope';
import { escapeLike } from '../read-crm/common';
import { TARGET_IDS_MAX, clipText, versionSql } from './common';

const { contacts } = schema;

export const ContactFilterSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe('A mesma busca do search_contacts: parte do nome, e-mail ou telefone.'),
  })
  .strict();

export const contactTargetShape = {
  contact_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(TARGET_IDS_MAX)
    .optional()
    .describe('Contatos escolhidos (até 200). Use OU contact_ids OU filter.'),
  filter: ContactFilterSchema.optional(),
} as const;

export interface ContactTargetArgs {
  readonly contact_ids?: readonly string[] | undefined;
  readonly filter?: { readonly query: string } | undefined;
}

export function oneContactSelector(v: ContactTargetArgs): boolean {
  return (v.contact_ids !== undefined) !== (v.filter !== undefined);
}

export interface ContactRowLite {
  readonly id: string;
  readonly label: string;
  /** `coalesce(updated_at, created_at)::text`. */
  readonly version: string;
  readonly displayName: string | null;
  readonly language: string | null;
  readonly timezone: string | null;
  readonly customFields: Record<string, unknown>;
}

const contactColumns = {
  id: contacts.id,
  displayName: contacts.displayName,
  profileName: contacts.profileName,
  language: contacts.language,
  timezone: contacts.timezone,
  customFields: contacts.customFields,
  version: versionSql(contacts.updatedAt, contacts.createdAt),
};

function lite(r: {
  id: string;
  displayName: string | null;
  profileName: string | null;
  language: string | null;
  timezone: string | null;
  customFields: Record<string, unknown>;
  version: string;
}): ContactRowLite {
  return {
    id: r.id,
    label: clipText(r.displayName ?? r.profileName, 200) ?? 'Contato sem nome',
    version: r.version,
    displayName: r.displayName,
    language: r.language,
    timezone: r.timezone,
    customFields: r.customFields ?? {},
  };
}

function contactWhere(principal: CopilotPrincipal, extra: SQL | undefined): SQL {
  const scope = contactScope(principal);
  const conds: SQL[] = [
    eq(contacts.workspaceId, principal.workspaceId),
    isNull(contacts.deletedAt),
  ];
  if (scope) conds.push(scope);
  if (extra) conds.push(extra);
  return and(...conds) as SQL;
}

/** Predicado do `search_contacts`. */
export function contactSearchPredicate(query: string): SQL {
  const pattern = `%${escapeLike(query)}%`;
  const digits = query.replace(/\D/g, '');
  const matches: SQL[] = [
    ilike(contacts.displayName, pattern),
    ilike(contacts.profileName, pattern),
    ilike(contacts.email, pattern),
  ];
  if (digits.length >= 4) matches.push(sql`${contacts.phone} like ${`%${digits}%`}`);
  return or(...matches) as SQL;
}

export async function loadContactTargets(
  tx: DbTx,
  principal: CopilotPrincipal,
  args: ContactTargetArgs,
): Promise<{ rows: ContactRowLite[]; dropped: { id: string; reason: 'not_found' }[] }> {
  if (args.contact_ids) {
    const ids = [...new Set(args.contact_ids)];
    const found = await tx
      .select(contactColumns)
      .from(contacts)
      .where(contactWhere(principal, inArray(contacts.id, ids)));
    const byId = new Map(found.map((r) => [r.id, lite(r)]));
    const rows: ContactRowLite[] = [];
    const dropped: { id: string; reason: 'not_found' }[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (row) rows.push(row);
      else dropped.push({ id, reason: 'not_found' });
    }
    return { rows, dropped };
  }
  const query = args.filter?.query ?? '';
  const found = await tx
    .select(contactColumns)
    .from(contacts)
    .where(contactWhere(principal, contactSearchPredicate(query)))
    .orderBy(
      asc(sql`${contacts.displayName} is null`),
      asc(contacts.displayName),
      desc(contacts.createdAt),
    )
    .limit(BATCH_LIMIT + 1);
  return { rows: found.map(lite), dropped: [] };
}

/** Relê UM contato para escrever, travado e sob o escopo. */
export async function lockContact(
  tx: DbTx,
  principal: CopilotPrincipal,
  contactId: string,
): Promise<ContactRowLite | null> {
  const [row] = await tx
    .select(contactColumns)
    .from(contacts)
    .where(contactWhere(principal, eq(contacts.id, contactId)))
    .limit(1)
    .for('update');
  return row ? lite(row) : null;
}
