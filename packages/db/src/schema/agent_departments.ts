/**
 * Agent ↔ Department routing (F34-S01: AGENT_DEPARTMENT_ROUTING_PLAN §4.1).
 *
 * Vínculo N:N entre agentes de IA (`agents`) e departamentos (`departments`):
 * um agente pode atender vários departamentos; um departamento pode ter vários
 * agentes. `is_default` marca o **agente de entrada DAQUELE departamento** (quem
 * atende a primeira mensagem quando ainda não há agente sticky na conversa).
 *
 * RLS: tabela com `workspace_id` próprio (denormalizado, padrão `team_members`/
 * `contact_tags`) → isolamento direto. Na escrita, casar `agent_departments.
 * workspace_id` com `agents.workspace_id` e `departments.workspace_id`.
 *
 * Garantia D2 (no máximo 1 agente de entrada por departamento) é imposta no nível
 * do banco por um índice parcial ÚNICO em `(department_id) WHERE is_default` — não
 * confiamos só na app.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, primaryKey, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { agents, departments, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ─── agent_departments (join N:N) ─────────────────────────────────────────────
export const agentDepartments = pgTable(
  'agent_departments',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    // workspace_id denormalizado p/ RLS direta (espelha team_members/contact_tags).
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // agente de entrada daquele departamento (atende a primeira mensagem).
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.departmentId] }),
    index('idx_agent_departments_department').on(t.departmentId),
    index('idx_agent_departments_workspace').on(t.workspaceId),
    // D2: no máximo 1 agente default por departamento (índice parcial único).
    uniqueIndex('uq_agent_departments_one_default_per_dept')
      .on(t.departmentId)
      .where(sql`${t.isDefault}`),
  ],
);
