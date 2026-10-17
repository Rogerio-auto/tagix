/**
 * Notas internas por conversa (F73-S08, extraído de `routes/conversations/notes.ts`).
 *
 * Um só caminho para a tela e para o Copiloto: a nota só nasce em conversa VISÍVEL ao autor
 * (`assertConversationVisible`, F30); as menções são filtradas para membros DESTE workspace e
 * materializadas em `mentions`. O aviso de menção (`note:mentioned`, sala `member:<id>`) sai
 * DEPOIS do commit, por quem chama (`notifyNoteMentions`).
 *
 * Nota interna nunca vai ao contato.
 */
import { Buffer } from 'node:buffer';
import { and, eq, inArray } from 'drizzle-orm';
import { assertConversationVisible, schema, type DbTx } from '@hm/db';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { Role } from '@hm/shared';

const { conversationNotes, members } = schema;

export type ConversationNoteRow = typeof conversationNotes.$inferSelect;

/** Limite de corpo da nota (anti-abuso; alinhado a mensagens internas). */
export const MAX_NOTE_BODY = 5000;

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/**
 * Evento de notificação de menção. NÃO existe ainda em `@hm/shared` `SERVER_TO_CLIENT_EVENTS`
 * (ver REPORT do F1-S22): constante local com o contrato pretendido.
 */
export const NOTE_MENTION_EVENT = 'note:mentioned' as const;

export interface NoteAuthor {
  readonly memberId: string;
  readonly role: Role;
}

export interface CreateNoteInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly author: NoteAuthor;
  readonly body: string;
  /** Ids de membros mencionados; os que não são do workspace são descartados. */
  readonly mentions?: readonly string[];
}

/**
 * Cria a nota. `null` = conversa inexistente ou invisível ao autor (indistinguíveis: a rota
 * responde 404 sem confirmar existência).
 */
export async function createNote(
  tx: DbTx,
  input: CreateNoteInput,
): Promise<ConversationNoteRow | null> {
  const { workspaceId, conversationId, author } = input;
  if (
    !(await assertConversationVisible(
      tx,
      { memberId: author.memberId, role: author.role, workspaceId },
      conversationId,
    ))
  ) {
    return null;
  }

  const requested = [...new Set(input.mentions ?? [])];
  let mentions: string[] = [];
  if (requested.length > 0) {
    const rows = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.workspaceId, workspaceId), inArray(members.id, requested)));
    mentions = rows.map((r) => r.id);
  }

  const [note] = await tx
    .insert(conversationNotes)
    .values({
      workspaceId,
      conversationId,
      authorMemberId: author.memberId,
      body: input.body,
      mentions,
    })
    .returning();
  return note ?? null;
}

export type DeleteNoteResult = 'deleted' | 'not_found' | 'changed';

/**
 * Apaga uma nota (desfazer do Copiloto). Com `expectedBody`, só apaga se o corpo ainda for esse
 * e a nota não tiver sido editada (`changed` caso contrário): o desfazer nunca apaga o que outra
 * pessoa reescreveu.
 */
export async function deleteNote(
  tx: DbTx,
  input: { readonly noteId: string; readonly expectedBody?: string },
): Promise<DeleteNoteResult> {
  const [current] = await tx
    .select({
      id: conversationNotes.id,
      body: conversationNotes.body,
      updatedAt: conversationNotes.updatedAt,
    })
    .from(conversationNotes)
    .where(eq(conversationNotes.id, input.noteId))
    .limit(1)
    .for('update');
  if (!current) return 'not_found';
  if (
    input.expectedBody !== undefined &&
    (current.body !== input.expectedBody || current.updatedAt !== null)
  ) {
    return 'changed';
  }
  // A linha está travada: o que foi conferido acima é o que é apagado.
  const deleted = await tx
    .delete(conversationNotes)
    .where(eq(conversationNotes.id, input.noteId))
    .returning({ id: conversationNotes.id });
  return deleted.length > 0 ? 'deleted' : 'not_found';
}

// ── Aviso de menção (relay do socket; canal AMQP lazy, compartilhado por processo) ──────

let handlePromise: Promise<MqHandle> | null = null;

async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

export interface MentionRelayInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly noteId: string;
  readonly memberId: string;
  readonly authorMemberId: string | null;
  readonly preview: string;
}

/** Publicador do aviso de menção (injetável em teste). */
export type MentionPublisher = (input: MentionRelayInput) => Promise<void>;

async function relayMention(input: MentionRelayInput): Promise<void> {
  const { channel } = await getMqHandle();
  const envelope = makeEnvelope('socket.relay', input.workspaceId, {
    event: NOTE_MENTION_EVENT,
    target: { memberId: input.memberId },
    data: {
      conversationId: input.conversationId,
      noteId: input.noteId,
      mentionedMemberId: input.memberId,
      authorMemberId: input.authorMemberId,
      preview: input.preview,
    },
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await Promise.resolve();
}

let mentionPublisher: MentionPublisher = relayMention;

/** Troca o publicador (testes). `null` volta ao relay real. */
export function setMentionPublisher(p: MentionPublisher | null): void {
  mentionPublisher = p ?? relayMention;
}

/**
 * Avisa cada mencionado (exceto o autor). Best-effort: a nota já está gravada; falha de broker
 * não derruba nada. Chame DEPOIS do commit da transação que criou a nota.
 */
export async function notifyNoteMentions(
  workspaceId: string,
  note: Pick<ConversationNoteRow, 'id' | 'conversationId' | 'authorMemberId' | 'body' | 'mentions'>,
): Promise<void> {
  const preview = note.body.length > 140 ? `${note.body.slice(0, 137)}...` : note.body;
  const recipients = note.mentions.filter((id) => id !== note.authorMemberId);
  await Promise.allSettled(
    recipients.map((memberId) =>
      mentionPublisher({
        workspaceId,
        conversationId: note.conversationId,
        noteId: note.id,
        memberId,
        authorMemberId: note.authorMemberId,
        preview,
      }),
    ),
  );
}
