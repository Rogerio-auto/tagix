/**
 * `list_conversations` · conversas da inbox sob a MESMA visibilidade da tela (F73-S07).
 *
 * Escopo: `conversationScope` (F73-S03) = `buildVisibilityPredicate` da inbox (F30: eixo de
 * departamentos/overrides + privacidade entre colegas). É o predicado de
 * `GET /api/conversations`, por import; aqui nada é reescrito.
 *
 * Só metadados, então NÃO contamina o turno: o `model_view` leva id, canal, status, tempo de
 * espera e o responsável (nome de membro). Nome do contato (que pode vir do perfil do canal,
 * escrito pelo próprio contato) e prévia da última mensagem ficam FORA do `model_view`; o
 * nome aparece só no cartão, que a interface renderiza (o modelo cita pelo `result_id`).
 *
 * "Esperando" = conversa aberta/pendente cuja última mensagem foi do contato: alguém do nosso
 * lado deve uma resposta. `waiting_minutes` conta desde essa mensagem.
 */
import { and, asc, desc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { schema } from '@hm/db';
import { z } from 'zod';
import { conversationScope } from '../../../services/copilot/identity/scope';
import { defineCopilotTool } from '../core/registry';
import { clip, clipOrNull } from '../read-crm/common';
import { clampLimit, fitModelView, READ_MAX_ROWS, startRead } from '../read-crm/limits';
import {
  CHANNEL_PROVIDERS,
  channelLabel,
  contactDisplayName,
  minutesSince,
  type ChannelFamily,
} from './common';

const { conversations, channels, contacts, members } = schema;

const OPEN_STATUSES = ['open', 'pending'] as const;
const RESOLVED_STATUSES = ['resolved', 'closed'] as const;
/** Teto do filtro de espera: 30 dias em minutos. */
const WAITING_MINUTES_MAX = 30 * 24 * 60;

const ArgsSchema = z
  .object({
    status: z
      .enum(['waiting', 'open', 'resolved'])
      .optional()
      .describe(
        'waiting = aguardando resposta nossa (última mensagem do contato); open = abertas ou ' +
          'pendentes; resolved = resolvidas ou fechadas. Sem status: todas.',
      ),
    assigned: z
      .union([z.enum(['me', 'unassigned']), z.string().uuid()])
      .optional()
      .describe('me = minhas; unassigned = sem responsável; ou o id de um membro.'),
    channel: z.enum(['whatsapp', 'instagram']).optional(),
    waiting_minutes_gte: z
      .number()
      .int()
      .min(0)
      .max(WAITING_MINUTES_MAX)
      .optional()
      .describe('Só as que esperam resposta nossa há pelo menos N minutos.'),
    limit: z.number().int().min(1).max(READ_MAX_ROWS).default(20),
  })
  .strict();

export const listConversations = defineCopilotTool({
  key: 'list_conversations',
  capability: 'query',
  area: 'conversations',
  description:
    'Lista conversas da inbox que o usuário vê (até 50): canal, status, responsável e há ' +
    'quantos minutos o cliente espera resposta. Use status=waiting para "quem está ' +
    'esperando". Não traz o conteúdo nem o nome do contato (o cartão mostra o nome); para ' +
    'ler uma conversa use get_conversation_digest.',
  args: ArgsSchema,
  requires: ['conversation.view'],
  taintsTurn: false,
  async handler(ctx, args) {
    const { tx, principal } = ctx;
    await startRead(tx);
    const now = new Date();

    const conds: SQL[] = [eq(conversations.workspaceId, principal.workspaceId)];
    const scope = conversationScope(principal);
    if (scope) conds.push(scope);

    const waitingFilter = args.status === 'waiting' || args.waiting_minutes_gte !== undefined;
    if (waitingFilter) {
      conds.push(inArray(conversations.status, [...OPEN_STATUSES]));
      conds.push(eq(conversations.lastMessageFrom, 'contact'));
    } else if (args.status === 'open') {
      conds.push(inArray(conversations.status, [...OPEN_STATUSES]));
    }
    if (args.status === 'resolved') {
      conds.push(inArray(conversations.status, [...RESOLVED_STATUSES]));
    }
    if (args.waiting_minutes_gte !== undefined) {
      conds.push(
        lte(
          conversations.lastMessageAt,
          new Date(now.getTime() - args.waiting_minutes_gte * 60_000),
        ),
      );
    }
    if (args.assigned === 'me') {
      conds.push(eq(conversations.assignedTo, principal.memberId));
    } else if (args.assigned === 'unassigned') {
      conds.push(isNull(conversations.assignedTo));
    } else if (args.assigned !== undefined) {
      conds.push(eq(conversations.assignedTo, args.assigned));
    }
    if (args.channel) {
      const family: ChannelFamily = args.channel;
      conds.push(inArray(channels.provider, [...CHANNEL_PROVIDERS[family]]));
    }

    const limit = clampLimit(args.limit, 20);
    const rows = await tx
      .select({
        id: conversations.id,
        status: conversations.status,
        lastMessageAt: conversations.lastMessageAt,
        lastMessageFrom: conversations.lastMessageFrom,
        assignedTo: conversations.assignedTo,
        remoteId: conversations.remoteId,
        groupName: conversations.groupName,
        assignedName: members.name,
        provider: channels.provider,
        displayName: contacts.displayName,
        profileName: contacts.profileName,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(conversations)
      .innerJoin(channels, eq(channels.id, conversations.channelId))
      .leftJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(members, eq(members.id, conversations.assignedTo))
      .where(and(...conds))
      .orderBy(
        // Esperando: quem espera há mais tempo primeiro. Demais: atividade mais recente.
        ...(waitingFilter
          ? [asc(conversations.lastMessageAt), asc(conversations.id)]
          : [sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.id)]),
      )
      .limit(limit);

    const total = rows[0]?.total ?? 0;
    const truncated = total > rows.length;
    const items = rows.map((r) => {
      const waiting =
        r.lastMessageFrom === 'contact' &&
        r.lastMessageAt !== null &&
        (r.status === 'open' || r.status === 'pending');
      return {
        row: r,
        channel: channelLabel(r.provider),
        waitingMinutes: waiting && r.lastMessageAt ? minutesSince(r.lastMessageAt, now) : null,
        assignedName: r.assignedTo ? clip(r.assignedName, 120, 'Membro') : null,
      };
    });

    const emitted = ctx.emitResult({
      kind: 'conversation_list',
      source: { label: 'Inbox', as_of: now.toISOString(), record_count: total },
      truncated,
      data: {
        items: items.map((i) => ({
          conversation_id: i.row.id,
          contact_name: clipOrNull(
            contactDisplayName({
              displayName: i.row.displayName,
              profileName: i.row.profileName,
              remoteId: i.row.remoteId,
              provider: i.row.provider,
              groupName: i.row.groupName,
            }),
            200,
          ),
          channel: clip(i.channel, 40, 'Canal'),
          status: clip(i.row.status, 40, 'open'),
          assigned_to_name: i.assignedName,
          last_message_at: i.row.lastMessageAt ? i.row.lastMessageAt.toISOString() : null,
          waiting_minutes: i.waitingMinutes,
        })),
      },
    });

    const fitted = fitModelView(items, (shown, omitted) => ({
      total,
      returned: shown.length,
      truncated: truncated || omitted > 0,
      items: shown.map((i) => ({
        id: i.row.id,
        channel: i.channel,
        status: i.row.status,
        waiting_minutes: i.waitingMinutes,
        last_message_at: i.row.lastMessageAt ? i.row.lastMessageAt.toISOString() : null,
        assigned_to: i.assignedName,
        assigned_to_me: i.row.assignedTo === principal.memberId,
      })),
    }));

    return { ok: true, decision: 'executed', model_view: fitted.view, ...emitted };
  },
});
