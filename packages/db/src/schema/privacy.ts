/**
 * LGPD — data export jobs (F10-S02).
 *
 * `data_export_jobs` é a fila durável dos pedidos de exportação de PII (direito de
 * acesso/portabilidade do titular). A API cria a linha `pending`; um processador no
 * worker (`startPrivacyExportProcessor`) drena, reúne a PII do `scope` (workspace
 * inteiro ou um único contato) sob RLS, grava o artefato JSON via `@hm/storage` e
 * marca `done` com a chave do artefato e `expires_at` (link expira → não vaza PII
 * indefinidamente). Falhas marcam `failed` com `error`.
 *
 * RLS: tem `workspace_id` próprio → isolamento direto (migration custom).
 *
 * O delete/anonimização (direito ao esquecimento) NÃO usa esta tabela — é síncrono
 * na API (`POST /privacy/contacts/:id/forget`) e registra a operação em `audit_logs`.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Discriminated scope do export: workspace inteiro ou um titular específico. */
export type DataExportScope = { kind: 'workspace' } | { kind: 'contact'; contactId: string };

export const dataExportJobs = pgTable(
  'data_export_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Quem pediu (member). SET NULL preserva a linha se o member for removido.
    requestedBy: uuid('requested_by').references(() => members.id, { onDelete: 'set null' }),
    // Escopo do export (DataExportScope). jsonb forte = contrato; validação na borda.
    scope: jsonb('scope').$type<DataExportScope>().notNull(),
    status: text('status').notNull().default('pending'),
    // Chave do objeto no @hm/storage (não é a URL — a URL assinada é gerada na leitura).
    artifactKey: text('artifact_key'),
    artifactBytes: text('artifact_bytes'),
    error: text('error'),
    // Validade do artefato/baixa — após isto o link não é mais servido.
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [
    // Hot-path do processador: varre pendentes em ordem de chegada.
    index('idx_data_export_jobs_pending')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    index('idx_data_export_jobs_workspace').on(t.workspaceId, t.createdAt.desc()),
    check(
      'data_export_jobs_status_chk',
      sql`${t.status} in ('pending','processing','done','failed')`,
    ),
  ],
);
