/**
 * Leads de anúncios da Meta (F69-S03 — META_INTEGRACAO_PLAN §5.1–5.3).
 *
 * - `lead_ad_sources`: páginas do Facebook de onde o workspace recebe leads. A
 *   página é assinada no campo `leadgen` pela conexão Meta (F69-S02).
 * - `lead_ad_submissions`: cada lead recebido — o que chegou, o que virou (contato,
 *   conversa, card) e se deu certo.
 *
 * ## Por que guardar o lead além de criar o contato
 *
 * A Meta guarda o dado do formulário por tempo limitado, e a busca pode falhar
 * (token expirado, permissão retirada, Meta fora do ar). O registro do lead é o que
 * permite retentar, reconciliar e responder "chegou todo lead que eu paguei?" —
 * pergunta que o dono faz no primeiro mês.
 *
 * ## Consentimento guardado como evidência
 *
 * `consent_responses` guarda as caixas marcadas no formulário. **Não** vira
 * consentimento de canal em `contact_consents`: a Meta devolve se a caixa foi
 * marcada, mas não o texto que a pessoa leu (verificado na documentação em
 * 2026-09-15). Registrar consentimento sem o texto exibido seria uma afirmação sem
 * prova — o mesmo motivo pelo qual a importação de público exige a origem (F58-S08).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { contacts, conversations, workspaces } from './index';
import { metaConnections } from './meta_connections';
import { deals } from './pipeline';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type LeadAdSourceStatus = 'active' | 'inactive';

export const leadAdSources = pgTable(
  'lead_ad_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * Conexão cujo token busca os leads. `cascade`: sem conexão não há como buscar,
     * e uma fonte sem token só produziria falhas silenciosas.
     */
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'cascade' }),
    pageId: text('page_id').notNull(),
    pageName: text('page_name'),
    status: text('status').$type<LeadAdSourceStatus>().notNull().default('active'),
    subscribedAt: ts('subscribed_at'),
    /** Até quando a reconciliação já conferiu. Nulo = nunca reconciliou. */
    lastReconciledAt: ts('last_reconciled_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_lead_ad_sources_workspace_page').on(t.workspaceId, t.pageId),
    index('idx_lead_ad_sources_page').on(t.pageId),
    check('lead_ad_sources_status_chk', sql`${t.status} in ('active','inactive')`),
  ],
);

export type LeadAdSubmissionStatus = 'received' | 'processed' | 'failed';

/**
 * Evidência de consentimento do formulário, como estava no momento do lead.
 *
 * O texto vem do cadastro do formulário (`legal_content.custom_disclaimer`), lido
 * junto com o lead. Se o cliente editar o formulário depois, este registro continua
 * dizendo o que ESTA pessoa leu — por isso é cópia, não referência.
 */
export interface LeadConsentEvidence {
  readonly capturedFrom: 'meta_lead_form';
  readonly formId: string | null;
  readonly formName: string | null;
  readonly disclaimerTitle: string | null;
  readonly disclaimerBody: string | null;
  readonly checkboxes: ReadonlyArray<{
    readonly checkboxKey: string;
    readonly isChecked: boolean;
    /** Texto da caixa. `null` quando a Meta não devolveu o cadastro do formulário. */
    readonly text: string | null;
  }>;
  /** Quando a pessoa enviou o formulário (ISO), segundo a Meta. */
  readonly submittedAt: string | null;
}

export const leadAdSubmissions = pgTable(
  'lead_ad_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => leadAdSources.id, { onDelete: 'set null' }),
    leadgenId: text('leadgen_id').notNull(),
    pageId: text('page_id').notNull(),
    formId: text('form_id'),
    adId: text('ad_id'),
    /** Quando a pessoa enviou o formulário, segundo a Meta. */
    leadCreatedAt: ts('lead_created_at'),
    /** Respostas: nome do campo → valores. Dado pessoal, sob RLS. */
    answers: jsonb('answers').$type<Record<string, string[]>>(),
    consentResponses: jsonb('consent_responses').$type<LeadConsentEvidence>(),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    status: text('status').$type<LeadAdSubmissionStatus>().notNull().default('received'),
    /** Última falha, legível. Sem token e sem resposta da pessoa. */
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [
    // Webhook repetido, reconciliação e retry caem no mesmo lead: um registro só.
    uniqueIndex('uq_lead_ad_submissions_workspace_leadgen').on(t.workspaceId, t.leadgenId),
    index('idx_lead_ad_submissions_status').on(t.workspaceId, t.status, t.createdAt.desc()),
    check(
      'lead_ad_submissions_status_chk',
      sql`${t.status} in ('received','processed','failed')`,
    ),
  ],
);

export type LeadAdSource = typeof leadAdSources.$inferSelect;
export type LeadAdSubmission = typeof leadAdSubmissions.$inferSelect;
