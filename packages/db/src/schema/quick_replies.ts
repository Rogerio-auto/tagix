/**
 * Quick replies / respostas rápidas (F43-S01 / ONBOARDING.md §2.1).
 *
 * Respostas pré-definidas que o atendente insere no LiveChat com um clique.
 * Fazem parte do pacote por nicho instanciado no onboarding (departamentos +
 * respostas rápidas) — daí o `department_id` opcional: quando `null`, a resposta
 * é GLOBAL do workspace (vale para qualquer departamento); quando preenchido, é
 * sugerida no contexto daquele departamento.
 *
 * RLS: `workspace_id` próprio (NOT NULL) → isolamento direto por
 * `app.workspace_id`, coerente com o restante do projeto. A policy é aplicada na
 * migration custom dedicada (0048).
 *
 * Idempotência: UNIQUE(workspace_id, title) é a âncora do instanciador de
 * blueprint (re-onboarding não duplica respostas) — ver `quickRepliesRepo.upsert`.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { departments, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const quickReplies = pgTable(
  'quick_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Opcional — null = resposta global do workspace; preenchido = escopo do depto.
    departmentId: uuid('department_id').references((): AnyPgColumn => departments.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    position: integer('position').notNull().default(0),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('quick_replies_workspace_title_uq').on(t.workspaceId, t.title),
    index('idx_quick_replies_workspace').on(t.workspaceId),
    index('idx_quick_replies_department')
      .on(t.departmentId)
      .where(sql`${t.departmentId} is not null`),
  ],
);
