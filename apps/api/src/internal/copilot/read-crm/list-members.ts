/**
 * `list_members` · a equipe, para resolver "passa para a Paula" em um id (F73-S06).
 *
 * SEM e-mail e SEM telefone: o Copiloto só precisa de quem é a pessoa e qual o papel. Só
 * membros ATIVOS (convidado, inativo e bloqueado não recebem negócio). O nome do membro é
 * texto da própria empresa (não de contato), então não há contaminação do turno.
 */
import { and, asc, eq, ilike } from 'drizzle-orm';
import { schema } from '@hm/db';
import { ROLES } from '@hm/shared';
import { z } from 'zod';
import { defineCopilotTool } from '../core/registry';
import { clip, clipOrNull, escapeLike, ROLE_LABELS } from './common';
import { clampLimit, fitModelView, READ_MAX_ROWS, startRead } from './limits';

const { members } = schema;

const ArgsSchema = z
  .object({
    role: z.enum(ROLES).optional().describe('Filtra por papel.'),
    query: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe('Parte do nome, para achar "a Paula".'),
    limit: z.number().int().min(1).max(READ_MAX_ROWS).default(READ_MAX_ROWS),
  })
  .strict();

export const listMembers = defineCopilotTool({
  key: 'list_members',
  capability: 'query',
  area: 'members',
  description:
    'Lista os membros ativos da equipe (nome e papel, sem e-mail nem telefone), com o id para ' +
    'usar como responsável. Use para resolver um nome ("passa para a Paula") antes de pedir a ação.',
  args: ArgsSchema,
  requires: ['pipeline.view'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    const limit = clampLimit(args.limit, READ_MAX_ROWS);
    const rows = await tx
      .select({ id: members.id, name: members.name, role: members.role })
      .from(members)
      .where(
        and(
          eq(members.workspaceId, principal.workspaceId),
          eq(members.status, 'active'),
          ...(args.role ? [eq(members.role, args.role)] : []),
          ...(args.query ? [ilike(members.name, `%${escapeLike(args.query)}%`)] : []),
        ),
      )
      .orderBy(asc(members.name), asc(members.id))
      .limit(limit + 1);

    const truncated = rows.length > limit;
    const shown = rows.slice(0, limit);
    const people = shown.map((m) => ({
      id: m.id,
      name: clip(m.name, 120, 'Sem nome'),
      role: m.role,
      role_label: ROLE_LABELS[m.role] ?? m.role,
    }));

    const emitted = ctx.emitResult({
      kind: 'table',
      source: { label: 'Equipe', as_of: new Date().toISOString(), record_count: shown.length },
      truncated,
      data: {
        currency: null,
        columns: [
          { key: 'member_id', label: 'Id', format: 'text' },
          { key: 'name', label: 'Nome', format: 'text' },
          { key: 'role', label: 'Papel', format: 'text' },
        ],
        rows: people.map((p) => ({ member_id: p.id, name: p.name, role: p.role_label })),
      },
    });

    const fitted = fitModelView(people, (visible, omitted) => ({
      returned: visible.length,
      truncated: truncated || omitted > 0,
      members: visible.map((p) => ({
        id: p.id,
        name: clipOrNull(p.name, 60),
        role: p.role,
      })),
    }));

    return { ok: true, decision: 'executed', model_view: fitted.view, ...emitted };
  },
});
