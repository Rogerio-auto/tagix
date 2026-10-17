/**
 * `contact.tag` — adicionar ou remover uma tag de contatos pelo Copiloto (F73-S08).
 *
 * Regras de domínio: as da tela (`addTags`/`removeTags`). A tag precisa existir no catálogo
 * (que é curado na tela de tags, `team.edit`): o Copiloto não cria tag. Alvos: `contact_ids`
 * ou a busca do `search_contacts`, sob `contactScope`; quem já está no estado pedido (já tem a
 * tag ao adicionar, não tem ao remover) sai da lista.
 *
 * Versão do alvo: se ele tem ou não a tag (o que a ação muda). Desfazer: restaura o conjunto
 * anterior (tira a tag que pôs, devolve a que tirou) se o estado ainda é o que o Copiloto deixou.
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type DbTx } from '@hm/db';
import { addTags, findTag, listContactTags, removeTags } from '../../../services/contacts/tags';
import type {
  CapabilityExecutor,
  ExecuteItemResult,
  ExecutorPreview,
  ResolvedTargets,
  Target,
  TargetRef,
  UndoItemResult,
} from '../core/executor-types';
import { clipText, jsonBool, jsonString, plural, sentence } from './common';
import { describeSelection } from './criteria';
import {
  contactTargetShape,
  loadContactTargets,
  lockContact,
  oneContactSelector,
  type ContactRowLite,
} from './contact-targets';

const { contactTags, members } = schema;

export const TagContactsArgsSchema = z
  .object({
    ...contactTargetShape,
    tag: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('Nome exato da tag (já cadastrada) ou o id dela.'),
    op: z.enum(['add', 'remove']).describe('add = adicionar; remove = remover.'),
  })
  .strict()
  .refine(oneContactSelector, { message: 'Use contact_ids OU filter (um dos dois).' });
export type TagContactsArgs = z.infer<typeof TagContactsArgsSchema>;

export const TAG_CONTACTS_TOOL_DESCRIPTION =
  'Propõe adicionar ou remover UMA tag (já cadastrada) de contatos, por ids (contact_ids, até 200) ou pela mesma ' +
  'busca do search_contacts. O sistema mostra a prévia (tags antes e depois) e decide se precisa de confirmação. ' +
  'Se ficar aguardando confirmação, diga isso e pare.';

function version(tagId: string, has: boolean): string {
  return `${tagId}:${has ? 1 : 0}`;
}

async function hasTag(tx: DbTx, contactId: string, tagId: string): Promise<boolean> {
  const [row] = await tx
    .select({ tagId: contactTags.tagId })
    .from(contactTags)
    .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)))
    .limit(1);
  return row !== undefined;
}

/** Quem marcou por último (para o "editado por"); quem desmarcou não deixa rastro. */
async function lastTagger(tx: DbTx, contactId: string, tagId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ name: members.name })
    .from(contactTags)
    .innerJoin(members, eq(members.id, contactTags.taggedBy))
    .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)))
    .orderBy(desc(contactTags.taggedAt))
    .limit(1);
  return clipText(row?.name, 120) ?? undefined;
}

async function toTargets(
  tx: DbTx,
  rows: readonly ContactRowLite[],
  tag: { id: string; name: string },
): Promise<Target[]> {
  const tagsBy = await listContactTags(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const names = (tagsBy.get(r.id) ?? []).map((t) => t.name);
    const has = (tagsBy.get(r.id) ?? []).some((t) => t.id === tag.id);
    return {
      type: 'contact' as const,
      id: r.id,
      label: r.label,
      expectedVersion: version(tag.id, has),
      state: { tag_id: tag.id, has_tag: has, tags: names },
    };
  });
}

function tagList(names: readonly string[]): string {
  const s = names.length > 0 ? names.join(', ') : '—';
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

function stateTags(t: Target): string[] {
  const v = t.state['tags'];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export const tagContactsExecutor: CapabilityExecutor<TagContactsArgs> = {
  capability: 'contact.tag',
  argsSchema: TagContactsArgsSchema,
  requires: ['contact.view'],

  async resolveTargets(ctx, args): Promise<ResolvedTargets> {
    const tag = await findTag(ctx.tx, args.tag);
    if (!tag) {
      return {
        targets: [],
        dropped: (args.contact_ids ?? []).map((id) => ({ id, reason: 'not_found' as const })),
      };
    }
    const loaded = await loadContactTargets(ctx.tx, ctx.principal, args);
    const targets = await toTargets(ctx.tx, loaded.rows, tag);
    const wantHas = args.op === 'add';
    return {
      targets: targets.filter((t) => t.state['has_tag'] !== wantHas),
      dropped: loaded.dropped,
    };
  },

  /** Re-resolve sob outro principal. A tag não é conhecida aqui: o estado lido é só a lista. */
  async resolveIds(ctx, refs: readonly TargetRef[]): Promise<ResolvedTargets> {
    const ids = refs.filter((r) => r.type === 'contact').map((r) => r.id);
    const loaded =
      ids.length > 0
        ? await loadContactTargets(ctx.tx, ctx.principal, { contact_ids: ids })
        : { rows: [], dropped: [] };
    const tagsBy = await listContactTags(
      ctx.tx,
      loaded.rows.map((r) => r.id),
    );
    return {
      targets: loaded.rows.map((r) => ({
        type: 'contact' as const,
        id: r.id,
        label: r.label,
        expectedVersion: null,
        state: { tags: (tagsBy.get(r.id) ?? []).map((t) => t.name) },
      })),
      dropped: [
        ...refs
          .filter((r) => r.type !== 'contact')
          .map((r) => ({ id: r.id, reason: 'not_found' as const })),
        ...loaded.dropped,
      ],
    };
  },

  async preview(ctx, args, targets): Promise<ExecutorPreview> {
    const tag = await findTag(ctx.tx, args.tag);
    const tagName = tag?.name ?? args.tag;
    const add = args.op === 'add';
    return {
      items: targets.map((t) => {
        const before = stateTags(t);
        const after = add
          ? [...new Set([...before, tagName])].sort((a, b) => a.localeCompare(b))
          : before.filter((n) => n !== tagName);
        return {
          targetId: t.id,
          before: tagList(before),
          after: tagList(after),
          plannedAfter: { has_tag: add },
        };
      }),
      impact: {
        notified_members: [],
        affected_count: targets.length,
        criterion: args.filter
          ? sentence(
              `Contatos encontrados pela busca do pedido (${plural(targets.length, 'contato', 'contatos')})`,
              300,
            )
          : describeSelection(targets.length, 'contato', 'contatos'),
      },
      external: false,
      irreversible: false,
      notifiesMembers: false,
      summary: sentence(
        add
          ? `Adicionar a tag ${tagName} a ${plural(targets.length, 'contato', 'contatos')}`
          : `Remover a tag ${tagName} de ${plural(targets.length, 'contato', 'contatos')}`,
        500,
      ),
      beforeAfter: [
        {
          label: 'Tag',
          before: add ? 'sem a tag' : `com ${tagName}`.slice(0, 200),
          after: add ? `com ${tagName}`.slice(0, 200) : 'sem a tag',
          count: targets.length,
        },
      ],
    };
  },

  async executeItem(ctx, args, item): Promise<ExecuteItemResult> {
    const { tx, principal } = ctx;
    const tagId = jsonString(item.before, 'tag_id');
    if (!tagId) return { status: 'failed', errorCode: 'tag_not_found' };
    const contact = await lockContact(tx, principal, item.targetId);
    if (!contact) return { status: 'failed', errorCode: 'not_found' };
    const has = await hasTag(tx, contact.id, tagId);
    if (version(tagId, has) !== item.expectedVersion) {
      const by = has ? await lastTagger(tx, contact.id, tagId) : undefined;
      return { status: 'skipped_conflict', ...(by ? { conflictBy: by } : {}) };
    }
    if (args.op === 'add') {
      const out = await addTags(tx, {
        workspaceId: principal.workspaceId,
        contactId: contact.id,
        tagIds: [tagId],
        taggedBy: principal.memberId,
      });
      if (out.kind === 'no_contact') return { status: 'failed', errorCode: 'not_found' };
      if (out.kind === 'no_tag') return { status: 'failed', errorCode: 'tag_not_found' };
    } else {
      await removeTags(tx, { contactId: contact.id, tagIds: [tagId] });
    }
    return {
      status: 'done',
      after: { tag_id: tagId, has_tag: args.op === 'add' },
      undoPayload: { tag_id: tagId, had_tag: has },
    };
  },

  async undoItem(ctx, item): Promise<UndoItemResult> {
    const { tx, principal } = ctx;
    const tagId = jsonString(item.undoPayload, 'tag_id');
    const had = jsonBool(item.undoPayload, 'had_tag');
    const left = jsonBool(item.after, 'has_tag');
    if (!tagId || had === null || left === null)
      return { status: 'failed', errorCode: 'undo_payload' };
    const contact = await lockContact(tx, principal, item.targetId);
    if (!contact) return { status: 'undo_conflict' };
    if ((await hasTag(tx, contact.id, tagId)) !== left) return { status: 'undo_conflict' };
    if (had) {
      const out = await addTags(tx, {
        workspaceId: principal.workspaceId,
        contactId: contact.id,
        tagIds: [tagId],
        taggedBy: principal.memberId,
      });
      if (out.kind !== 'ok') return { status: 'undo_conflict' };
    } else {
      await removeTags(tx, { contactId: contact.id, tagIds: [tagId] });
    }
    return { status: 'undone' };
  },
};
