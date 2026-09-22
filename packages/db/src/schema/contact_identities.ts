/**
 * Identidades do contato (F60-S01 — CANAIS_PLAN.md §3.2).
 *
 * `contacts` tem índice único por `(workspace_id, phone)`, o que pressupõe
 * telefone como identidade. Isso é verdade em WhatsApp e falso em e-mail e
 * webchat.
 *
 * O caso concreto: um lead chega por formulário só com e-mail, recebe nutrição
 * por e-mail, e três semanas depois manda WhatsApp de um número que ninguém
 * associou a ele. São dois contatos, dois históricos — e o agente responde como
 * se nunca tivesse falado com a pessoa.
 *
 * Esta tabela é o índice reverso `(tipo, valor) → contato`. Ela **não funde**
 * contatos: fundir errado mistura o histórico de duas pessoas e é irreversível
 * na prática, então a fusão é slot próprio, com confirmação humana.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { contacts, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const CONTACT_IDENTITY_KINDS = [
  'phone',
  'email',
  'ig_user',
  'fb_user',
  'web_visitor',
] as const;
export type ContactIdentityKind = (typeof CONTACT_IDENTITY_KINDS)[number];

export const contactIdentities = pgTable(
  'contact_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<ContactIdentityKind>(),
    /** Já normalizado pela aplicação — ver `normalizeIdentity`. */
    value: text('value').notNull(),
    /** Preenchido quando a posse do identificador foi comprovada (clique, código). */
    verifiedAt: ts('verified_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // É esta constraint que impede dois contatos com o mesmo e-mail no workspace.
    unique('uq_contact_identities_value').on(t.workspaceId, t.kind, t.value),
    index('idx_contact_identities_contact').on(t.workspaceId, t.contactId),
    check(
      'contact_identities_kind_chk',
      sql`${t.kind} in ('phone','email','ig_user','fb_user','web_visitor')`,
    ),
    check('contact_identities_value_chk', sql`length(${t.value}) between 1 and 320`),
  ],
);

export type ContactIdentity = typeof contactIdentities.$inferSelect;
export type NewContactIdentity = typeof contactIdentities.$inferInsert;
