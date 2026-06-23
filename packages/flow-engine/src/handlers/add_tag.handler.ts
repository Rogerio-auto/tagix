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
import { and, eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { FlowHandler } from '../types';

// Aceita `tagId` (UUID — flows da UI) OU `tag` (nome — templates de nicho, resolvido em
// runtime). Os Niche Blueprints referenciam a tag por nome porque o UUID só existe após
// a provisionagem; resolver aqui conserta os templates sem reescrever o snapshot do flow.
const addTagSchema = z
  .object({
    tagId: z.string().uuid().optional(),
    tag: z.string().min(1).optional(),
  })
  .refine((d) => d.tagId !== undefined || d.tag !== undefined, {
    message: 'add_tag exige tagId ou tag',
  });

const { contactTags, tags } = schema;

export const addTagHandler: FlowHandler<z.infer<typeof addTagSchema>> = {
  schema: addTagSchema,
  async execute(node, ctx) {
    const data = addTagSchema.parse(node.data);
    if (!ctx.contactId) {
      ctx.log('warn', 'add_tag: execucao sem contactId; no-op', { nodeType: 'add_tag' });
      return { status: 'SUCCESS' };
    }
    const tagId = await withWorkspace(ctx.workspaceId, async (tx) => {
      let resolved = data.tagId;
      if (!resolved && data.tag) {
        const [row] = await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.workspaceId, ctx.workspaceId), eq(tags.name, data.tag)))
          .limit(1);
        resolved = row?.id;
      }
      if (!resolved) return null;
      await tx
        .insert(contactTags)
        .values({ contactId: ctx.contactId!, tagId: resolved, workspaceId: ctx.workspaceId })
        .onConflictDoNothing();
      return resolved;
    });
    if (!tagId) {
      ctx.log('warn', 'add_tag: tag nao resolvida (nome inexistente); no-op', { tag: data.tag });
      return { status: 'SUCCESS' };
    }
    ctx.log('info', 'add_tag: tag aplicada ao contato', { contactId: ctx.contactId, tagId });
    return { status: 'SUCCESS' };
  },
};
