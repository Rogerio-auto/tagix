/** Conversations — thread entre contact e workspace (DATA_MODEL §6.3). */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { channels, contacts, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    remoteId: text('remote_id').notNull(),
    kind: text('kind').notNull().default('direct'),
    status: text('status').notNull().default('open'),
    aiMode: text('ai_mode').notNull().default('off'),
    // Handoff de IA (F30 / LIVECHAT_OPS §2): por que a IA pausou, quando e por quem.
    aiPausedReason: text('ai_paused_reason'),
    aiPausedAt: ts('ai_paused_at'),
    aiPausedBy: uuid('ai_paused_by').references(() => members.id, { onDelete: 'set null' }),
    // Base do gatilho de ociosidade: última atividade humana na conversa.
    aiLastHumanAt: ts('ai_last_human_at'),
    // Reengajamento agendado (cron idempotente) — null quando não há retomada pendente.
    aiResumeAt: ts('ai_resume_at'),
    assignedTo: uuid('assigned_to').references(() => members.id, { onDelete: 'set null' }),
    // FK adicionada quando departments/teams/agents existirem (F1+/F2).
    departmentId: uuid('department_id'),
    teamId: uuid('team_id'),
    agentId: uuid('agent_id'),
    groupName: text('group_name'),
    groupAvatarUrl: text('group_avatar_url'),
    lastMessageId: uuid('last_message_id'),
    lastMessagePreview: text('last_message_preview'),
    lastMessageAt: ts('last_message_at'),
    lastMessageFrom: text('last_message_from'),
    unreadCount: integer('unread_count').notNull().default(0),
    pinned: boolean('pinned').notNull().default(false),
    snoozedUntil: ts('snoozed_until'),
    // F55-S01 — Marcos do ciclo de atendimento (base de métricas de SLA).
    // Nullable sem default: NULL = o marco ainda não ocorreu. A app/worker grava o
    // instante exato nas transições de status; o histórico recebe backfill aproximado.
    firstResponseAt: ts('first_response_at'), // 1ª resposta humana (outbound de member).
    resolvedAt: ts('resolved_at'), // quando a conversa foi marcada resolvida.
    closedAt: ts('closed_at'), // quando a conversa foi fechada.
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_conversations_channel_remote').on(t.channelId, t.remoteId),
    index('idx_conversations_ws_status_lastmsg').on(
      t.workspaceId,
      t.status,
      t.lastMessageAt.desc(),
    ),
    index('idx_conversations_assigned').on(t.assignedTo).where(sql`${t.assignedTo} is not null`),
    index('idx_conversations_contact').on(t.contactId).where(sql`${t.contactId} is not null`),
    // NB: idx_conversations_team / idx_conversations_department já existem (compostos
    // com workspace_id, criados na migration 0033) — hot-path da list query escopada
    // por dept/time (F30 / LIVECHAT_OPS §1). Não recriados aqui.
    // Varredura do cron de reengajamento de IA (F30 / LIVECHAT_OPS §2).
    index('idx_conversations_ai_resume').on(t.aiResumeAt).where(sql`${t.aiResumeAt} is not null`),
    // F55-S01 — Métricas de ciclo: parciais (só linhas com o marco) e escopados por
    // workspace (toda consulta de SLA filtra workspace_id), DESC p/ recência primeiro.
    index('idx_conversations_ws_resolved_at')
      .on(t.workspaceId, t.resolvedAt.desc())
      .where(sql`${t.resolvedAt} is not null`),
    index('idx_conversations_ws_first_response_at')
      .on(t.workspaceId, t.firstResponseAt.desc())
      .where(sql`${t.firstResponseAt} is not null`),
    check('conversations_kind_chk', sql`${t.kind} in ('direct','group','story_thread','comment_thread')`),
    check('conversations_status_chk', sql`${t.status} in ('open','pending','closed','resolved','snoozed')`),
    check('conversations_ai_mode_chk', sql`${t.aiMode} in ('off','on','paused')`),
    check(
      'conversations_ai_paused_reason_chk',
      sql`${t.aiPausedReason} in ('human_takeover','manual') or ${t.aiPausedReason} is null`,
    ),
    check(
      'conversations_last_from_chk',
      sql`${t.lastMessageFrom} in ('contact','member','agent','system') or ${t.lastMessageFrom} is null`,
    ),
  ],
);
