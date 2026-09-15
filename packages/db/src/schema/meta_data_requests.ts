/**
 * Pedidos da Meta sobre dados de usuário: exclusão e desautorização (F69-S01).
 *
 * ## Tabela de plataforma, sem workspace
 *
 * O pedido chega identificado só pelo ID do usuário com escopo do app — não por
 * workspace. Quem removeu o app pode ter conectado a Meta em mais de um workspace,
 * ou em nenhum. Por isso a tabela não tem `workspace_id` nem RLS de tenant, como
 * `webhook_events`.
 *
 * ## O que ela guarda, e o que não guarda
 *
 * Guarda o mínimo para cumprir e provar o cumprimento: o ID com escopo do app, o
 * código de confirmação que a Meta mostra ao usuário, o estado e quantos itens
 * foram removidos. **Não guarda o que foi apagado** — um registro de exclusão que
 * guarda o conteúdo excluído não excluiu nada.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type MetaDataRequestKind = 'deletion' | 'deauthorize';

/**
 * - `received`: registrado, ação em andamento.
 * - `completed`: dados localizados e removidos (ou tokens revogados).
 * - `no_data`: nada ligado a este usuário — resposta honesta e legítima.
 * - `failed`: a remoção falhou; fica visível para retentar.
 */
export type MetaDataRequestStatus = 'received' | 'completed' | 'no_data' | 'failed';

export const metaDataRequests = pgTable(
  'meta_data_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<MetaDataRequestKind>().notNull(),
    /** ID do usuário com escopo do app, vindo do `signed_request`. */
    metaUserId: text('meta_user_id').notNull(),
    /** Código que a Meta exibe ao usuário e que abre a página de acompanhamento. */
    confirmationCode: text('confirmation_code').notNull(),
    status: text('status').$type<MetaDataRequestStatus>().notNull().default('received'),
    itemsRemoved: integer('items_removed').notNull().default(0),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('uq_meta_data_requests_code').on(t.confirmationCode),
    index('idx_meta_data_requests_user').on(t.kind, t.metaUserId, t.requestedAt.desc()),
    check('meta_data_requests_kind_chk', sql`${t.kind} in ('deletion','deauthorize')`),
    check(
      'meta_data_requests_status_chk',
      sql`${t.status} in ('received','completed','no_data','failed')`,
    ),
  ],
);

export type MetaDataRequest = typeof metaDataRequests.$inferSelect;
