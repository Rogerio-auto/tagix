/**
 * Memória de entregas de notificação ao membro (F61-S04 — APP_MOBILE_PLAN §4.2).
 *
 * ## Por que uma tabela, e não um contador em Redis
 *
 * Duas funções, e a segunda é a que decide:
 *
 * 1. **Dedupe estrutural.** O índice único em
 *    `(workspace, member, event_key, channel)` faz a segunda tentativa falhar no
 *    banco — não numa checagem que corre contra outro consumidor da mesma fila.
 *    Retry é comum, não exceção.
 *
 * 2. **Responder "por que não fui avisado?".** Sem registro, essa pergunta não tem
 *    resposta. E a primeira vez que o dono a fizer sem obter resposta, ele para de
 *    confiar no aviso e passa a conferir o app "por garantia" — que é exatamente
 *    o trabalho que o produto deveria ter tirado dele.
 *
 * Por isso `status` guarda também o que NÃO saiu, com o motivo em `suppressedBy`.
 * Um Redis com TTL resolveria (1) e perderia (2).
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type DeliveryStatus = 'enviado' | 'falhou' | 'suprimido';

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    /**
     * Identidade do FATO notificado — `lead_novo:<conversation_id>`, por exemplo.
     * É o que torna o dedupe possível: dois disparos do mesmo fato compartilham a
     * chave, mesmo vindos de execuções diferentes do worker.
     */
    eventKey: text('event_key').notNull(),
    channel: text('channel').notNull(),
    status: text('status').$type<DeliveryStatus>().notNull(),
    /** Preenchido quando `status = 'suprimido'`. A resposta ao "por que não fui avisado?". */
    suppressedBy: text('suppressed_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_notification_deliveries_evento').on(
      t.workspaceId,
      t.memberId,
      t.eventKey,
      t.channel,
    ),
    index('idx_notification_deliveries_member_time').on(
      t.workspaceId,
      t.memberId,
      t.createdAt.desc(),
    ),
    check(
      'notification_deliveries_status_chk',
      sql`${t.status} in ('enviado','falhou','suprimido')`,
    ),
  ],
);

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
