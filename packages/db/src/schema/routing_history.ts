/**
 * Routing history (F1-S23 / LIVECHAT.md) — trilha auditável de roteamento de
 * conversas: cada atribuição (auto-assign / assign-to-me) e transferência manual
 * (entre members ou departments) gera uma linha imutável aqui.
 *
 * Captura o estado ANTES e DEPOIS (member e/ou department), o ator que executou
 * a ação e uma razão opcional, permitindo reconstruir a fila/ownership de uma
 * conversa ao longo do tempo. Append-only: linhas nunca são editadas.
 *
 * Tabela tenant-scoped (`workspace_id`) → RLS obrigatória no mesmo slot
 * (migration custom, ver `drizzle/0013_routing_history_rls.sql`).
 *
 * FKs para `departments`/`teams` ainda não existem no schema (entram em F1+) →
 * `from_department`/`to_department` ficam como `uuid` SEM `.references()`; a FK é
 * adicionada quando a tabela `departments` existir.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const routingHistory = pgTable(
  'routing_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Tipo da mudança de roteamento (atribuição vs. transferência). */
    action: text('action').notNull(),
    /** Member que detinha a conversa antes da mudança (null se não atribuída). */
    fromMemberId: uuid('from_member_id').references(() => members.id, { onDelete: 'set null' }),
    /** Member que passa a deter a conversa (null em transferência só de department). */
    toMemberId: uuid('to_member_id').references(() => members.id, { onDelete: 'set null' }),
    /** Department de origem — FK adicionada quando `departments` existir (F1+). */
    fromDepartment: uuid('from_department'),
    /** Department de destino — FK adicionada quando `departments` existir (F1+). */
    toDepartment: uuid('to_department'),
    /** Justificativa opcional da transferência (texto livre, exibido na timeline). */
    reason: text('reason'),
    /** Quem executou a ação (member autenticado, ou null para automação/sistema). */
    actorMemberId: uuid('actor_member_id').references(() => members.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_routing_history_conversation_created').on(t.conversationId, t.createdAt.desc()),
    index('idx_routing_history_workspace_created').on(t.workspaceId, t.createdAt.desc()),
    check(
      'routing_history_action_chk',
      sql`${t.action} in ('assign','unassign','transfer_member','transfer_department','auto_assign')`,
    ),
  ],
);
