/**
 * Modulo de moderacao de comments IG (INSTAGRAM.md 7.2). Operacoes Graph:
 *   - listar comments de um media (GET /{media-id}/comments)
 *   - responder publicamente (POST /{comment-id}/replies)
 *   - responder privadamente / comment-to-DM (POST /{ig-user-id}/messages com recipient.comment_id)
 *   - ocultar (POST /{comment-id} { hide:true })
 *   - deletar (DELETE /{comment-id})
 *
 * Funcoes puras sobre o GraphClient compartilhado; sem any.
 */

import type { GraphClient } from '../../shared/graphClient';

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export interface IgCommentSummary {
  readonly id: string;
  readonly text?: string;
  readonly username?: string;
  readonly timestamp?: string;
  readonly hidden?: boolean;
}

/** Resultado de uma acao que retorna um id criado (ex.: reply publico). */
export interface IgCommentActionResult {
  readonly ok: boolean;
  readonly id?: string;
  readonly raw?: unknown;
}

/** GET /{media-id}/comments -> lista achatada de comments (sem replies aninhadas). */
export async function listComments(
  graph: GraphClient,
  mediaId: string,
  accessToken: string,
): Promise<IgCommentSummary[]> {
  const fields = 'id,text,username,timestamp,hidden,replies{id,text,username,timestamp,hidden}';
  const res = await graph.get(mediaId + '/comments?fields=' + encodeURIComponent(fields), accessToken);
  if (!isRecord(res)) return [];
  const data = Array.isArray(res['data']) ? res['data'] : [];
  return data.filter(isRecord).map(toSummary);
}

function toSummary(c: JsonRecord): IgCommentSummary {
  const id = asString(c['id']) ?? '';
  const text = asString(c['text']);
  const username = asString(c['username']);
  const timestamp = asString(c['timestamp']);
  const hidden = c['hidden'] === true;
  return {
    id,
    ...(text !== undefined ? { text } : {}),
    ...(username !== undefined ? { username } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    hidden,
  };
}

/** POST /{comment-id}/replies { message } -> reply publica. */
export async function replyPublic(
  graph: GraphClient,
  commentId: string,
  text: string,
  accessToken: string,
): Promise<IgCommentActionResult> {
  const res = await graph.post(commentId + '/replies', { message: text }, accessToken);
  const id = isRecord(res) ? asString(res['id']) : undefined;
  return { ok: true, ...(id !== undefined ? { id } : {}), raw: res };
}

/** POST /{ig-user-id}/messages { recipient:{ comment_id }, message:{ text } }. */
export async function replyPrivate(
  graph: GraphClient,
  igUserId: string,
  commentId: string,
  text: string,
  accessToken: string,
): Promise<IgCommentActionResult> {
  const res = await graph.post(
    igUserId + '/messages',
    { recipient: { comment_id: commentId }, message: { text } },
    accessToken,
  );
  const id = isRecord(res)
    ? asString(res['message_id']) ?? asString(res['recipient_id'])
    : undefined;
  return { ok: true, ...(id !== undefined ? { id } : {}), raw: res };
}

/** POST /{comment-id} { hide } -> oculta/exibe um comment. */
export async function hideComment(
  graph: GraphClient,
  commentId: string,
  hide: boolean,
  accessToken: string,
): Promise<void> {
  await graph.post(commentId, { hide }, accessToken);
}

/** DELETE /{comment-id} -> remove o comment. */
export async function deleteComment(
  graph: GraphClient,
  commentId: string,
  accessToken: string,
): Promise<void> {
  await graph.delete(commentId, accessToken);
}
