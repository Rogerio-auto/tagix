/**
 * Consentimento e supressão por canal (F59-S03 — AGENCIA_PLAN.md §4.4).
 *
 * `contacts` já tinha `marketing_opt_in` + proveniência (`opt_in_method`,
 * `opt_in_source`, `opt_in_at`, `opt_out_at`). A intuição estava certa; o problema
 * é que é **um consentimento só para todos os canais**, e a lei americana é por
 * canal e por finalidade: quem aceitou receber WhatsApp não consentiu SMS de
 * marketing.
 *
 * - `contact_consents` (workspace-scoped → RLS): estado do consentimento de um
 *   contato num canal, para uma finalidade. `proof` carrega o **texto exato
 *   exibido** no momento em que a pessoa consentiu — não um identificador de
 *   versão de texto: o texto muda e a prova precisa valer no dia em que foi dada.
 * - `contact_suppressions` (workspace-scoped → RLS): quem não pode receber.
 *   `channel` NULO = supressão da **empresa inteira**. É a primeira tabela que o
 *   portão de envio consulta, e supressão sempre vence consentimento.
 *
 * A cláusula americana que torna "um STOP revoga tudo" obrigatória entra em
 * 31/01/2027. O escopo de empresa já existe aqui de propósito: implementar depois
 * seria migrar dado de consentimento retroativamente, que é o pior tipo de migration.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { contacts, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Canais reconhecidos pelo motor de consentimento (espelha `ChannelKind` de @hm/shared). */
export const CONSENT_CHANNELS = [
  'meta_whatsapp',
  'meta_instagram',
  'waha',
  'email',
  'sms',
  'webchat',
  'messenger',
] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export type ConsentPurpose = 'transactional' | 'marketing';
export type ConsentStatus = 'granted' | 'revoked' | 'never';

/**
 * Prova do consentimento. Guarda o que sustenta a defesa se alguém contestar:
 * o texto que a pessoa leu, onde leu, quando e de onde.
 */
export type ConsentProof = {
  /** Texto EXATO exibido no momento do aceite. */
  displayedText?: string;
  /** URL onde o aceite aconteceu. */
  url?: string;
  /** IP de origem — dado pessoal, entra na política de retenção. */
  ip?: string;
  userAgent?: string;
  /** Preenchido quando a linha veio da migração do booleano antigo. */
  migratedFrom?: string;
  [key: string]: unknown;
};

export const contactConsents = pgTable(
  'contact_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull().$type<ConsentChannel>(),
    purpose: text('purpose').notNull().$type<ConsentPurpose>(),
    status: text('status').notNull().$type<ConsentStatus>(),
    /** De onde veio: `webchat`, `form`, `import`, `manual`, `api`, `migration`. */
    source: text('source').notNull(),
    proof: jsonb('proof').$type<ConsentProof>().notNull().default({}),
    /** Membro que registrou, quando foi registro manual. */
    capturedBy: uuid('captured_by').references(() => members.id, { onDelete: 'set null' }),
    /** Mercado vigente no momento do registro — a regra aplicável não muda depois. */
    market: text('market').notNull().default('BR').$type<'BR' | 'US'>(),
    grantedAt: ts('granted_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('uq_contact_consents_scope').on(t.workspaceId, t.contactId, t.channel, t.purpose),
    index('idx_contact_consents_lookup').on(t.workspaceId, t.contactId, t.channel),
    check(
      'contact_consents_purpose_chk',
      sql`${t.purpose} in ('transactional','marketing')`,
    ),
    check(
      'contact_consents_status_chk',
      sql`${t.status} in ('granted','revoked','never')`,
    ),
    check('contact_consents_market_chk', sql`${t.market} in ('BR','US')`),
    // Linha `granted` sem carimbo de quando é prova incompleta.
    check(
      'contact_consents_granted_at_chk',
      sql`(${t.status} <> 'granted') or (${t.grantedAt} is not null)`,
    ),
  ],
);

export const contactSuppressions = pgTable(
  'contact_suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    /** NULO = supressão da empresa inteira, em todos os canais. */
    channel: text('channel').$type<ConsentChannel | null>(),
    /** `keyword`, `natural_language`, `bounce`, `complaint`, `manual`, `migration`. */
    reason: text('reason').notNull(),
    /** Evidência: mensagem original, classificação, confiança. */
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_contact_suppressions_lookup').on(t.workspaceId, t.contactId),
    // Índices parciais: um por escopo, porque UNIQUE com coluna nula não dedupe
    // no Postgres (NULL nunca é igual a NULL).
    index('idx_contact_suppressions_global')
      .on(t.workspaceId, t.contactId)
      .where(sql`${t.channel} is null`),
  ],
);

export type ContactConsent = typeof contactConsents.$inferSelect;
export type NewContactConsent = typeof contactConsents.$inferInsert;
export type ContactSuppression = typeof contactSuppressions.$inferSelect;
export type NewContactSuppression = typeof contactSuppressions.$inferInsert;
