/**
 * Orquestracao das acoes de comment IG (F15-S05). Resolve o canal IG do
 * comment (via ig_comments sob RLS), cria uma linha `messages` pending de
 * resposta quando aplicavel, e enfileira o OutboundJob IG que o worker outbound
 * (F15-S04) despacha. Tudo sob RLS (req.scoped). Sem any.
 *
 * Kinds suportados:
 *  - ig_public_reply / ig_private_reply: cria message pending + enfileira.
 *  - ig_hide_comment: enfileira hide (sem message); marca ig_comments.hidden.
 *  - ig_delete_comment: marca o comment como hidden no DB e registra audit
 *    (a exclusao dura na Graph e follow-up — ver COMMS/REPORT). Best-effort.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { Request } from 'express';
import { publishOutboundJob } from '../../mq/outbound-publisher';

export type CommentActionInput =
  | { kind: 'ig_public_reply'; commentId: string; text: string }
  | { kind: 'ig_private_reply'; commentId: string; text: string }
  | { kind: 'ig_hide_comment'; commentId: string; hide: boolean }
  | { kind: 'ig_delete_comment'; commentId: string };

export type CommentActionResult =
  | { ok: true; messageId?: string }
  | { ok: false; status: number; message: string };

interface ResolvedComment {
  readonly id: string;
  readonly channelId: string;
  readonly conversationId: string | null;
  readonly commentId: string;
}

/** Resolve o ig_comments + uma conversa associada (comment_thread) sob RLS. */
async function resolveComment(req: Request, externalCommentId: string): Promise<ResolvedComment | null> {
  const { igComments } = schema;
  const rows = await req.scoped!((tx) =>
    tx
      .select({
        id: igComments.id,
        channelId: igComments.channelId,
        mediaId: igComments.mediaId,
        fromIgsid: igComments.fromIgsid,
        commentId: igComments.commentId,
      })
      .from(igComments)
      .where(eq(igComments.commentId, externalCommentId))
      .limit(1),
  );
  const row = rows[0];
  if (row === undefined) return null;

  // Conversa comment_thread associada (remoteId = 'cmt:media:igsid' — F15-S03).
  const remoteId = 'cmt:' + (row.mediaId ?? '') + ':' + (row.fromIgsid ?? '');
  const convRows = await req.scoped!((tx) =>
    tx
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.remoteId, remoteId))
      .limit(1),
  );
  return {
    id: row.id,
    channelId: row.channelId,
    conversationId: convRows[0]?.id ?? null,
    commentId: row.commentId ?? externalCommentId,
  };
}

/** Cria uma message outbound `pending` na conversa (para correlacao de status). */
async function createPendingMessage(
  req: Request,
  workspaceId: string,
  conversationId: string,
  type: 'comment_reply' | 'text',
  content: string,
): Promise<string | null> {
  const senderMemberId = req.auth!.member.id;
  const rows = await req.scoped!((tx) =>
    tx
      .insert(schema.messages)
      .values({
        workspaceId,
        conversationId,
        direction: 'outbound',
        senderType: 'member',
        senderMemberId,
        type,
        content,
        viewStatus: 'pending',
      })
      .returning({ id: schema.messages.id }),
  );
  return rows[0]?.id ?? null;
}

export async function enqueueCommentAction(
  req: Request,
  input: CommentActionInput,
): Promise<CommentActionResult> {
  const workspaceId = req.auth!.workspace.id;
  const resolved = await resolveComment(req, input.commentId);
  if (resolved === null) {
    return { ok: false, status: 404, message: 'Comment nao encontrado no workspace.' };
  }

  // delete: soft no DB + audit (hard delete na Graph = follow-up).
  if (input.kind === 'ig_delete_comment') {
    await req.scoped!(async (tx) => {
      await tx
        .update(schema.igComments)
        .set({ hidden: true, updatedAt: new Date() })
        .where(eq(schema.igComments.id, resolved.id));
      await tx.insert(schema.auditLogs).values({
        workspaceId,
        actorMemberId: req.auth!.member.id,
        actorType: 'member',
        action: 'ig.comment.delete',
        resourceType: 'ig_comment',
        resourceId: resolved.id,
        metadata: { commentId: resolved.commentId },
      });
    });
    return { ok: true };
  }

  // hide: marca DB + enfileira hide.
  if (input.kind === 'ig_hide_comment') {
    await req.scoped!((tx) =>
      tx
        .update(schema.igComments)
        .set({ hidden: input.hide, updatedAt: new Date() })
        .where(eq(schema.igComments.id, resolved.id)),
    );
    if (resolved.conversationId === null) {
      return { ok: false, status: 409, message: 'Sem conversa associada ao comment.' };
    }
    await publishOutboundJob(workspaceId, {
      kind: 'ig_hide_comment',
      channelId: resolved.channelId,
      conversationId: resolved.conversationId,
      messageId: resolved.id,
      commentId: resolved.commentId,
      hide: input.hide,
    });
    return { ok: true };
  }

  // reply public/private: cria message pending + enfileira.
  if (resolved.conversationId === null) {
    return { ok: false, status: 409, message: 'Sem conversa associada ao comment.' };
  }
  const msgType = input.kind === 'ig_public_reply' ? 'comment_reply' : 'text';
  const messageId = await createPendingMessage(
    req,
    workspaceId,
    resolved.conversationId,
    msgType,
    input.text,
  );
  if (messageId === null) {
    return { ok: false, status: 500, message: 'Falha ao criar a mensagem.' };
  }

  await publishOutboundJob(workspaceId, {
    kind: input.kind,
    channelId: resolved.channelId,
    conversationId: resolved.conversationId,
    messageId,
    commentId: resolved.commentId,
    text: input.text,
  });
  return { ok: true, messageId };
}
