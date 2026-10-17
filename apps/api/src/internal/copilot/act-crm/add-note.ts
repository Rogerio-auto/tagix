/**
 * `conversation.note` — escrever uma nota interna numa conversa pelo Copiloto (F73-S08).
 *
 * Mesmo service da tela (`createNote`): só em conversa VISÍVEL a quem executa (F30), autor =
 * o membro. A nota é interna: o cliente nunca a vê. O alvo é a conversa (sem versão: somar
 * uma nota não conflita com nada).
 *
 * Desfazer = apagar a nota, só se ela não foi editada depois (`deleteNote` com o corpo esperado).
 */
import { z } from 'zod';
import type { ProposalPreview } from '@hm/shared';
import { createNote, deleteNote } from '../../../services/conversation-notes/create';
import { resolveVisible } from '../../../services/copilot/identity/scope';
import type {
  CapabilityExecutor,
  ExecuteItemResult,
  ExecutorContext,
  ExecutorPreview,
  ResolvedTargets,
  Target,
  TargetRef,
  UndoItemResult,
} from '../core/executor-types';
import { jsonString } from './common';

export const NOTE_BODY_MAX = 2000;

export const AddNoteArgsSchema = z
  .object({
    conversation_id: z.string().uuid().describe('A conversa (de list_conversations).'),
    body: z.string().trim().min(1).max(NOTE_BODY_MAX).describe('Texto da nota interna (até 2000).'),
  })
  .strict();
export type AddNoteArgs = z.infer<typeof AddNoteArgsSchema>;

export const ADD_NOTE_TOOL_DESCRIPTION =
  'Propõe escrever uma nota interna numa conversa (a equipe vê; o cliente não). O sistema mostra a prévia e ' +
  'decide se precisa de confirmação. Se ficar aguardando confirmação, diga isso e pare.';

async function visibleConversation(
  ctx: Pick<ExecutorContext, 'tx' | 'principal'>,
  id: string,
): Promise<Target | null> {
  const v = await resolveVisible(ctx.tx, ctx.principal, { type: 'conversation', id });
  return v
    ? { type: 'conversation', id: v.id, label: v.label, expectedVersion: null, state: {} }
    : null;
}

/** O texto em pedaços de 200 (limite de cada célula da prévia). */
function bodyRows(body: string): ProposalPreview['before_after'] {
  const chunks: string[] = [];
  for (let i = 0; i < body.length && chunks.length < 10; i += 200)
    chunks.push(body.slice(i, i + 200));
  return chunks.map((after, i) => ({
    label: chunks.length === 1 ? 'Nota interna' : `Nota interna (${i + 1}/${chunks.length})`,
    before: '—',
    after,
    count: 1,
  }));
}

export const addNoteExecutor: CapabilityExecutor<AddNoteArgs> = {
  capability: 'conversation.note',
  argsSchema: AddNoteArgsSchema,
  requires: ['conversation.view'],

  async resolveTargets(ctx, args): Promise<ResolvedTargets> {
    const t = await visibleConversation(ctx, args.conversation_id);
    return t
      ? { targets: [t], dropped: [] }
      : { targets: [], dropped: [{ id: args.conversation_id, reason: 'not_found' }] };
  },

  async resolveIds(ctx, refs: readonly TargetRef[]): Promise<ResolvedTargets> {
    const targets: Target[] = [];
    const dropped: { id: string; reason: 'not_found' }[] = [];
    for (const ref of refs) {
      const t = ref.type === 'conversation' ? await visibleConversation(ctx, ref.id) : null;
      if (t) targets.push(t);
      else dropped.push({ id: ref.id, reason: 'not_found' });
    }
    return { targets, dropped };
  },

  async preview(_ctx, args, targets): Promise<ExecutorPreview> {
    return {
      items: targets.map((t) => ({
        targetId: t.id,
        before: null,
        after: args.body.slice(0, 200),
        plannedAfter: { note: true },
      })),
      impact: {
        notified_members: [],
        affected_count: targets.length,
        criterion: 'A conversa citada no pedido. O cliente não vê notas internas.',
      },
      external: false,
      irreversible: false,
      notifiesMembers: false,
      summary: 'Escrever 1 nota interna numa conversa',
      beforeAfter: bodyRows(args.body),
    };
  },

  async executeItem(ctx, args, item): Promise<ExecuteItemResult> {
    const note = await createNote(ctx.tx, {
      workspaceId: ctx.principal.workspaceId,
      conversationId: item.targetId,
      author: { memberId: ctx.principal.memberId, role: ctx.principal.role },
      body: args.body,
    });
    if (!note) return { status: 'failed', errorCode: 'not_found' };
    return {
      status: 'done',
      after: { note_id: note.id },
      undoPayload: { note_id: note.id, body: note.body },
    };
  },

  async undoItem(ctx, item): Promise<UndoItemResult> {
    const noteId = jsonString(item.undoPayload, 'note_id');
    const body = jsonString(item.undoPayload, 'body');
    if (!noteId || body === null) return { status: 'failed', errorCode: 'undo_payload' };
    // Quem desfaz precisa ainda ver a conversa (mesmo escopo da escrita).
    if (!(await visibleConversation(ctx, item.targetId))) return { status: 'undo_conflict' };
    const out = await deleteNote(ctx.tx, { noteId, expectedBody: body });
    return out === 'deleted' ? { status: 'undone' } : { status: 'undo_conflict' };
  },
};
