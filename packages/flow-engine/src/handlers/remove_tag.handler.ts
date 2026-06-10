/**
 * Handler `remove_tag` (FLOW_BUILDER.md §4). F5-S16: remove a tag do contato da
 * execucao (contact_tags, RLS). Sem contato, no-op + log.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { FlowHandler } from '../types';

const removeTagSchema = z.object({ tagId: z.string().uuid() });

const { contactTags } = schema;

export const removeTagHandler: FlowHandler<z.infer<typeof removeTagSchema>> = {
  schema: removeTagSchema,
  async execute(node, ctx) {
    const data = removeTagSchema.parse(node.data);
    if (!ctx.contactId) {
      ctx.log('warn', 'remove_tag: execucao sem contactId; no-op', { nodeType: 'remove_tag' });
      return { status: 'SUCCESS' };
    }
    await withWorkspace(ctx.workspaceId, async (tx) => {
      await tx
        .delete(contactTags)
        .where(and(eq(contactTags.contactId, ctx.contactId!), eq(contactTags.tagId, data.tagId)));
    });
    ctx.log('info', 'remove_tag: tag removida do contato', {
      contactId: ctx.contactId,
      tagId: data.tagId,
    });
    return { status: 'SUCCESS' };
  },
};
