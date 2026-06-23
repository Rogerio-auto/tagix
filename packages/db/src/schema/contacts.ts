/** Contacts — a pessoa atendida (DATA_MODEL §5.1). */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Endereço estruturado do contato (F47-S01). Tipo forte (zero `any`); a validação
 * runtime fica na API (Zod). Autopreenchimento via ViaCEP no frontend (S06). Campos
 * por nicho continuam em `custom_fields`.
 */
export type ContactAddress = {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
};

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    phone: text('phone'),
    email: citext('email'),
    avatarUrl: text('avatar_url'),
    notes: text('notes'),
    language: text('language').default('pt-BR'),
    source: text('source'),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    optInMethod: text('opt_in_method'),
    optInSource: text('opt_in_source'),
    optInAt: ts('opt_in_at'),
    optOutAt: ts('opt_out_at'),
    optOutReason: text('opt_out_reason'),
    ownerId: uuid('owner_id').references(() => members.id, { onDelete: 'set null' }),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    // Cadastro estruturado (F47-S01): endereço tipado + documento (CPF/CNPJ).
    address: jsonb('address').$type<ContactAddress>().notNull().default({}),
    document: text('document'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('uq_contacts_workspace_phone')
      .on(t.workspaceId, t.phone)
      .where(sql`${t.phone} is not null and ${t.deletedAt} is null`),
    index('idx_contacts_workspace_name').on(t.workspaceId, t.displayName),
    index('idx_contacts_owner').on(t.ownerId).where(sql`${t.ownerId} is not null`),
    index('idx_contacts_opt_in').on(t.workspaceId, t.marketingOptIn),
    check(
      'contacts_opt_in_method_chk',
      sql`${t.optInMethod} in ('whatsapp','website','checkout','import','manual','api') or ${t.optInMethod} is null`,
    ),
  ],
);
