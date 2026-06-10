/** Comentários do Instagram (auxiliar, populada em F1.5). Comment threads de posts/reels/stories. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { channels, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const igComments = pgTable(
  'ig_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    mediaId: text('media_id'),
    commentId: text('comment_id'),
    parentCommentId: text('parent_comment_id'),
    fromIgsid: text('from_igsid'),
    fromUsername: text('from_username'),
    text: text('text'),
    mediaKind: text('media_kind'),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_ig_comments_channel_comment')
      .on(t.channelId, t.commentId)
      .where(sql`${t.commentId} is not null`),
    index('idx_ig_comments_workspace').on(t.workspaceId),
    index('idx_ig_comments_channel_media').on(t.channelId, t.mediaId),
    index('idx_ig_comments_parent')
      .on(t.parentCommentId)
      .where(sql`${t.parentCommentId} is not null`),
    check(
      'ig_comments_media_kind_chk',
      sql`${t.mediaKind} in ('post','reel','story') or ${t.mediaKind} is null`,
    ),
  ],
);
