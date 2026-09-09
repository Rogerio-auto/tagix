/**
 * Valores personalizados por workspace (F59-S07 — AGENCIA_PLAN.md §3.4).
 *
 * `{{nome_empresa}}`, `{{link_review}}`, `{{endereco}}`, `{{meta_dataset_id}}`
 * referenciados dentro de flows, prompts de agente, campanhas e e-mails. Trocar
 * de cliente vira editar N variáveis num lugar em vez de caçar a mesma string em
 * cinco automações — é a diferença entre onboarding de meio dia e de uma semana,
 * e o pré-requisito do template de workspace.
 *
 * `kind: 'secret'` (ex.: `{{capi_token}}`) é cifrado em repouso com o mesmo
 * AES-256-GCM dos secrets de canal e **nunca** volta em leitura de API — só a
 * existência e o rótulo.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * `text` — visível, editável, retorna na API.
 * `url`  — igual a text, com validação de URL na borda (Zod).
 * `secret` — cifrado em repouso, nunca retorna o valor.
 */
export const CUSTOM_VALUE_KINDS = ['text', 'url', 'secret'] as const;
export type CustomValueKind = (typeof CUSTOM_VALUE_KINDS)[number];

/**
 * Formato da chave: minúscula, começa por letra, sem espaço nem acento.
 * É o que aparece dentro de `{{...}}`, então precisa ser previsível de digitar.
 */
export const CUSTOM_VALUE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;

export const workspaceCustomValues = pgTable(
  'workspace_custom_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Slug referenciado como `{{key}}`. Único por workspace. */
    key: text('key').notNull(),
    /** Rótulo legível, exibido na UI de configuração. */
    label: text('label').notNull(),
    /** Valor. Cifrado quando `kind = 'secret'`. */
    value: text('value').notNull(),
    kind: text('kind').notNull().default('text').$type<CustomValueKind>(),
    description: text('description'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    unique('uq_workspace_custom_values_key').on(t.workspaceId, t.key),
    index('idx_workspace_custom_values_ws').on(t.workspaceId),
    check('workspace_custom_values_kind_chk', sql`${t.kind} in ('text','url','secret')`),
    check('workspace_custom_values_key_chk', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,48}$'`),
  ],
);

export type WorkspaceCustomValue = typeof workspaceCustomValues.$inferSelect;
export type NewWorkspaceCustomValue = typeof workspaceCustomValues.$inferInsert;
