/**
 * `contact.update` — editar campos de 1 contato pelo Copiloto (F73-S08).
 *
 * Só a allowlist do agente (`UPDATE_CONTACT_EDITABLE_FIELDS`: nome de exibição, idioma, fuso e
 * campos personalizados), com o MESMO Zod (`updateContactArgs`, por import) e o mesmo service
 * da escrita (`updateContactFields`). Campo com `null` = não mexe (igual ao agente).
 *
 * Prévia campo a campo. Versão: `updated_at` do contato. Desfazer: restaura os campos tocados se
 * o valor atual de cada um ainda é o que o Copiloto gravou.
 */
import { z } from 'zod';
import {
  patchFromSnapshot,
  snapshotContactFields,
  updateContactFields,
  type ContactFieldsPatch,
  type ContactFieldsSnapshot,
  type CustomFieldValue,
} from '../../../services/contacts/update';
import { updateContactArgs } from '../../tools/contact-handlers';
import type {
  CapabilityExecutor,
  ExecuteItemResult,
  ExecutorPreview,
  Json,
  ResolvedTargets,
  Target,
  UndoItemResult,
} from '../core/executor-types';
import { stableJson } from './common';
import { loadContactTargets, lockContact, type ContactRowLite } from './contact-targets';

export const UpdateContactArgsSchema = z
  .object({
    contact_id: z.string().uuid().describe('O contato (id de search_contacts ou get_contact).'),
    fields: updateContactArgs.describe(
      'Campos a mudar: display_name, language (ex.: pt-BR), timezone (IANA) e custom_fields (mescla).',
    ),
  })
  .strict();
export type UpdateContactArgs = z.infer<typeof UpdateContactArgsSchema>;

export const UPDATE_CONTACT_TOOL_DESCRIPTION =
  'Propõe editar 1 contato: nome de exibição, idioma, fuso e campos personalizados (só estes). O sistema mostra a ' +
  'prévia campo a campo e decide se precisa de confirmação. Se ficar aguardando confirmação, diga isso e pare.';

const FIELD_LABELS: Record<string, string> = {
  display_name: 'Nome',
  language: 'Idioma',
  timezone: 'Fuso',
};

/** Patch a partir dos campos validados (`null`/ausente = não mexe). */
export function patchOf(args: UpdateContactArgs): ContactFieldsPatch {
  const f = args.fields;
  const custom: Record<string, CustomFieldValue> = {};
  for (const [k, v] of Object.entries(f.custom_fields ?? {})) custom[k] = v;
  return {
    ...(f.display_name != null ? { display_name: f.display_name } : {}),
    ...(f.language != null ? { language: f.language } : {}),
    ...(f.timezone != null ? { timezone: f.timezone } : {}),
    ...(Object.keys(custom).length > 0 ? { custom_fields: custom } : {}),
  };
}

function snapshotOf(row: ContactRowLite, patch: ContactFieldsPatch): ContactFieldsSnapshot {
  return snapshotContactFields(
    {
      displayName: row.displayName,
      language: row.language,
      timezone: row.timezone,
      customFields: row.customFields,
    },
    patch,
  );
}

function shown(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

function isSnapshot(v: unknown): v is ContactFieldsSnapshot {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function target(row: ContactRowLite, patch: ContactFieldsPatch): Target {
  return {
    type: 'contact',
    id: row.id,
    label: row.label,
    expectedVersion: row.version,
    state: { fields: { ...snapshotOf(row, patch) } },
  };
}

export const updateContactExecutor: CapabilityExecutor<UpdateContactArgs> = {
  capability: 'contact.update',
  argsSchema: UpdateContactArgsSchema,
  requires: ['contact.view'],

  async resolveTargets(ctx, args): Promise<ResolvedTargets> {
    const loaded = await loadContactTargets(ctx.tx, ctx.principal, {
      contact_ids: [args.contact_id],
    });
    const patch = patchOf(args);
    return { targets: loaded.rows.map((r) => target(r, patch)), dropped: loaded.dropped };
  },

  async resolveIds(ctx, refs): Promise<ResolvedTargets> {
    const ids = refs.filter((r) => r.type === 'contact').map((r) => r.id);
    const loaded =
      ids.length > 0
        ? await loadContactTargets(ctx.tx, ctx.principal, { contact_ids: ids })
        : { rows: [], dropped: [] };
    return {
      targets: loaded.rows.map((r) => target(r, {})),
      dropped: [
        ...refs
          .filter((r) => r.type !== 'contact')
          .map((r) => ({ id: r.id, reason: 'not_found' as const })),
        ...loaded.dropped,
      ],
    };
  },

  async preview(_ctx, args, targets): Promise<ExecutorPreview> {
    const patch = patchOf(args);
    const t = targets[0];
    const before = isSnapshot(t?.state['fields'])
      ? (t.state['fields'] as ContactFieldsSnapshot)
      : {};
    const rows: { label: string; before: string; after: string; count: number }[] = [];
    for (const key of ['display_name', 'language', 'timezone'] as const) {
      if (patch[key] === undefined) continue;
      rows.push({
        label: FIELD_LABELS[key] ?? key,
        before: shown(before[key]),
        after: shown(patch[key]),
        count: 1,
      });
    }
    for (const [key, value] of Object.entries(patch.custom_fields ?? {})) {
      rows.push({
        label: `Campo ${key}`.slice(0, 200),
        before: shown(before.custom_fields?.[key]),
        after: shown(value),
        count: 1,
      });
    }
    const names = rows.map((r) => r.label.toLowerCase());
    return {
      items: targets.map((tt) => ({
        targetId: tt.id,
        before: `${rows.length} ${rows.length === 1 ? 'campo' : 'campos'}`,
        after: names.join(', ').slice(0, 200),
        plannedAfter: { fields: { ...patch } },
      })),
      impact: {
        notified_members: [],
        affected_count: targets.length,
        criterion: 'O contato citado no pedido',
      },
      external: false,
      irreversible: false,
      notifiesMembers: false,
      summary: `Editar 1 contato (${names.join(', ')})`.slice(0, 500),
      beforeAfter: rows.slice(0, 20),
    };
  },

  async executeItem(ctx, args, item): Promise<ExecuteItemResult> {
    const contact = await lockContact(ctx.tx, ctx.principal, item.targetId);
    if (!contact) return { status: 'failed', errorCode: 'not_found' };
    if (contact.version !== item.expectedVersion) return { status: 'skipped_conflict' };
    const out = await updateContactFields(ctx.tx, { contactId: contact.id, patch: patchOf(args) });
    if (!out) return { status: 'failed', errorCode: 'not_found' };
    return {
      status: 'done',
      after: { fields: { ...out.after } },
      undoPayload: { fields: { ...out.before } },
    };
  },

  async undoItem(ctx, item): Promise<UndoItemResult> {
    const placed: unknown = item.after?.['fields'];
    const previous: unknown = item.undoPayload?.['fields'];
    if (!isSnapshot(placed) || !isSnapshot(previous)) {
      return { status: 'failed', errorCode: 'undo_payload' };
    }
    const contact = await lockContact(ctx.tx, ctx.principal, item.targetId);
    if (!contact) return { status: 'undo_conflict' };
    // O estado atual dos campos tocados ainda é o que o Copiloto gravou?
    const restore = patchFromSnapshot(previous);
    const now = snapshotOf(contact, restore);
    if (stableJson(now) !== stableJson(placed as Json)) return { status: 'undo_conflict' };
    const out = await updateContactFields(ctx.tx, { contactId: contact.id, patch: restore });
    return out ? { status: 'undone' } : { status: 'undo_conflict' };
  },
};
