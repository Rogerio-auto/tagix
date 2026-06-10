/**
 * Agent templates (DATA_MODEL §7.2–7.3 / AGENTS_LANGGRAPH §16) — catálogo de
 * templates de agente. Templates globais da plataforma (`workspace_id IS NULL`,
 * `is_global = true`) são lidos por todos os workspaces; templates por workspace
 * (`workspace_id` setado) pertencem ao tenant.
 *
 * Tabela NÃO recebe RLS de tenant (linhas globais precisam ser legíveis por todos;
 * o filtro por workspace, quando aplicável, é feito no app). Ver index.ts → fora de
 * RLS_TABLES.
 *
 * `agent_template_questions` modela o wizard de criação (AgentCreationWizard):
 * cada pergunta vira input do formulário que preenche o prompt do template.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const agentTemplates = pgTable(
  'agent_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL = template global da plataforma; setado = template do workspace. */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    description: text('description'),
    promptTemplate: text('prompt_template').notNull(),
    defaultModel: text('default_model').notNull(),
    defaultModelParams: jsonb('default_model_params')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Tool keys habilitadas por default ao instanciar o template. */
    defaultTools: text('default_tools').array().notNull().default(sql`'{}'`),
    industry: text('industry'),
    isGlobal: boolean('is_global').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('agent_templates_workspace_key_uq').on(t.workspaceId, t.key),
    index('idx_agent_templates_global').on(t.isGlobal).where(sql`${t.isGlobal} = true`),
  ],
);

export const agentTemplateQuestions = pgTable(
  'agent_template_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => agentTemplates.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    required: boolean('required').notNull().default(false),
    help: text('help'),
    options: jsonb('options').$type<unknown[]>().notNull().default([]),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    unique('agent_template_questions_template_key_uq').on(t.templateId, t.key),
    check(
      'agent_template_questions_type_chk',
      sql`${t.type} in ('text','textarea','select','number','boolean','multiselect')`,
    ),
  ],
);
