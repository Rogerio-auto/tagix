import { and, desc, eq, lt } from 'drizzle-orm';
import { getDb } from '../client';
import { contacts, conversations, messages } from '../schema';

export const contactsRepo = {
  async findById(id: string) {
    const [row] = await getDb().select().from(contacts).where(eq(contacts.id, id));
    return row ?? null;
  },
};

export const conversationsRepo = {
  async findById(id: string) {
    const [row] = await getDb().select().from(conversations).where(eq(conversations.id, id));
    return row ?? null;
  },
  async findByChannelRemote(channelId: string, remoteId: string) {
    const [row] = await getDb()
      .select()
      .from(conversations)
      .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)));
    return row ?? null;
  },
};

export const messagesRepo = {
  /** Página de mensagens por conversa, ordenada por created_at desc, com cursor. */
  async listByConversation(conversationId: string, opts: { before?: Date; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const where = opts.before
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, opts.before))
      : eq(messages.conversationId, conversationId);
    return getDb()
      .select()
      .from(messages)
      .where(where)
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  },
};
