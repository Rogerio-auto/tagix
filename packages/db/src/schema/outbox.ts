/**
 * Outbox transacional (F70-S16, migração 0086).
 *
 * O produtor grava a mensagem (evento de domínio ou job) NA MESMA transação do dado,
 * com `enqueueOutbox(tx, …)`. O relay dos workers (`apps/workers/src/outbox`) lê com
 * `FOR UPDATE SKIP LOCKED`, publica no RabbitMQ com publisher confirms e marca `sent`.
 * Rollback não deixa linha: nada sai de uma transação que não aconteceu. Queda do
 * processo depois do commit não perde nada: a linha espera o relay.
 *
 * Tabela de SISTEMA (linhas de todos os workspaces). Acesso por privilégio, não por
 * leitura de tenant: `hm_app` só INSERT (+ SELECT da coluna `event_id`, exigido pelo
 * ON CONFLICT), preso ao workspace da transação pela RLS; o relay usa
 * `hm_outbox_relay`. Detalhes e motivo na migração 0086.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const OUTBOX_KINDS = ['event', 'job'] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export const OUTBOX_STATUSES = ['pending', 'sent', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const outbox = pgTable(
  'outbox',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Idempotência: eventId canônico (evento) ou id do envelope (job). */
    eventId: text('event_id').notNull(),
    kind: text('kind').$type<OutboxKind>().notNull(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** '' = fila direta (routing_key é o nome da fila); 'hm.events' = exchange de eventos. */
    exchange: text('exchange').notNull(),
    routingKey: text('routing_key').notNull(),
    /** Envelope pronto (`{ id, type, workspaceId, payload, ts }`). */
    envelope: jsonb('envelope').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<OutboxStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: ts('available_at').notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
  },
  (t) => [
    uniqueIndex('uq_outbox_event_id').on(t.eventId),
    index('idx_outbox_pending')
      .on(t.id)
      .where(sql`${t.status} = 'pending'`),
    index('idx_outbox_sent_at')
      .on(t.sentAt)
      .where(sql`${t.status} = 'sent'`),
    index('idx_outbox_dead')
      .on(t.createdAt)
      .where(sql`${t.status} = 'dead'`),
    index('idx_outbox_workspace').on(t.workspaceId),
    check('outbox_kind_chk', sql`${t.kind} in ('event', 'job')`),
    check('outbox_status_chk', sql`${t.status} in ('pending', 'sent', 'dead')`),
    check('outbox_exchange_chk', sql`${t.exchange} in ('', 'hm.events')`),
    check('outbox_event_id_len_chk', sql`char_length(${t.eventId}) between 1 and 256`),
    check('outbox_routing_key_len_chk', sql`char_length(${t.routingKey}) between 1 and 255`),
    check('outbox_attempts_chk', sql`${t.attempts} >= 0`),
    check('outbox_sent_at_chk', sql`(${t.status} = 'sent') = (${t.sentAt} is not null)`),
  ],
);

export type OutboxRow = typeof outbox.$inferSelect;
