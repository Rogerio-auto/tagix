/**
 * Handler `add_tag` (FLOW_BUILDER.md §4). F5-S16: aplica a tag ao contato da
 * execucao via contact_tags (RLS por workspace). Idempotente (onConflictDoNothing).
 *
 * O contato vem de `ctx.contactId`; sem contato, e no-op + log (flow disparado
 * fora de um contexto de contato). A tag e identificada por `data.tagId`.
 *
 * Acesso a DB direto via @hm/db withWorkspace (mesmo padrao do outbound.port).
 * A aplicacao da tag pode disparar flows `tag_added` (F5-S16 flows-triggers) e o
 * trigger pg de conversao (F5-S14) — ambos reagem ao INSERT em contact_tags.
 */
import { z } from 'zod';
import { schema, withWorkspace } from '@hm/db';
import type { FlowHandler } from '../types';

const addTagSchema = z.object({ tagId: z.string().uuid() });

const { contactTags } = schema;

export const addTagHandler: FlowHandler<z.infer<typeof addTagSchema>> = {
  schema: addTagSchema,
  async execute(node, ctx) {
    const data = addTagSchema.parse(node.data);
    if (!ctx.contactId) {
      ctx.log('warn', 'add_tag: execucao sem contactId; no-op', { nodeType: 'add_tag' });
      return { status: 'SUCCESS' };
    }
    await withWorkspace(ctx.workspaceId, async (tx) => {
      await tx
        .insert(contactTags)
        .values({ contactId: ctx.contactId!, tagId: data.tagId, workspaceId: ctx.workspaceId })
        .onConflictDoNothing();
    });
    ctx.log('info', 'add_tag: tag aplicada ao contato', {
      contactId: ctx.contactId,
      tagId: data.tagId,
    });
    return { status: 'SUCCESS' };
  },
};
