/**
 * Destinatários de `message.send` (F73-S09): resolver sob o escopo do membro e avaliar, um a
 * um, o que de fato sai.
 *
 * Resolver (`resolveRecipientTargets`, só na proposta e no ajuste):
 * - `contact_ids`: contatos que o membro vê (`contactScope`); quem não vê → `not_found`;
 * - `filter.events`: a régua da agenda por import (`calendarRepo.accessibleCalendarIds` +
 *   `expandOccurrences`, como `list_events`): contatos dos compromissos não cancelados da
 *   janela, cada um com o seu compromisso mais cedo;
 * - `filter.conversations`: a régua da inbox por import (`conversationScope`, como
 *   `list_conversations`): contatos das conversas que o membro vê.
 * A conversa de envio é a mais recente que o membro VÊ (ou a do filtro), no canal do modelo
 * quando há modelo. O alvo é o contato; o estado guarda conversa e compromisso.
 *
 * Avaliar (`evaluateRecipients`, na prévia, na política e no confirmar): relê TUDO do banco
 * (visibilidade da conversa, consentimento por `checkOutboundInTx`, janela de 24 h por
 * `computeWindow`, modelo aprovado, compromisso) e devolve, por destinatário, o texto final
 * renderizado com os dados DELE ou o motivo de ser pulado. É a mesma função para a prévia e
 * para a checagem recalculada: o que a pessoa vê é o que a política conta.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { calendarRepo, schema, type DbTx } from '@hm/db';
import {
  BATCH_LIMIT,
  isMarketCode,
  type MarketCode,
  type MessagePurpose,
  type OutboundDenyReason,
} from '@hm/shared';
import { expandOccurrences } from '../../../services/calendar-recurrence';
import { checkOutboundInTx } from '../../../services/consent';
import {
  conversationScope,
  contactScope,
  VISIBLE_LABEL_MAX,
} from '../../../services/copilot/identity/scope';
import { isChannelKind, windowFor } from '../../../services/messaging/send-on-behalf';
import type { OutboundTemplate } from '../../../services/messaging/outbound-job';
import { parseTemplateComponents, renderTemplate } from '../../../routes/campaigns/builder/render';
import type { TemplateBinding } from '../../../routes/campaigns/builder/contracts';
import type { ExecutorContext, Json, Target, TargetRef } from '../core/executor-types';
import { CHANNEL_PROVIDERS } from '../read-ops/common';
import type { SendMessagesArgs } from './message-args';
import {
  EVENT_VARIABLES,
  MISSING_VARIABLE_REASON,
  firstNameOf,
  formatDay,
  formatHour,
  renderMessage,
  scanPlaceholders,
  type MessageVariable,
  type VariableValues,
} from './render';

const {
  contacts,
  conversations,
  channels,
  events,
  calendars,
  messages,
  channelMessageTemplates,
  workspaces,
} = schema;

/** Canais por onde o Copiloto envia mensagem (WhatsApp oficial, WAHA e Instagram). */
export const MESSAGING_PROVIDERS = ['meta_whatsapp', 'waha', 'meta_instagram'] as const;
const OPEN_STATUSES = ['open', 'pending'] as const;
const RESOLVED_STATUSES = ['resolved', 'closed'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Janela da busca do "próximo compromisso" do contato (variáveis de horário). */
const NEXT_EVENT_WINDOW_DAYS = 31;
/** Teto de linhas lidas antes da expansão de recorrência (mesma ordem de `list_events`). */
const EVENTS_SCAN_MAX = 1000;

// ─── Estado persistido do alvo ────────────────────────────────────────────────────

const RecipientStateSchema = z.object({
  conversation_id: z.string().uuid().nullable(),
  event_id: z.string().uuid().nullable(),
  /** Início da OCORRÊNCIA (compromisso recorrente: o mestre não diz qual dia). */
  event_start_at: z.string().nullable(),
});
export type RecipientState = z.infer<typeof RecipientStateSchema>;

export function recipientStateOf(state: Json | null | undefined): RecipientState {
  const parsed = RecipientStateSchema.safeParse(state ?? {});
  return parsed.success
    ? parsed.data
    : { conversation_id: null, event_id: null, event_start_at: null };
}

/** Versão do alvo: o compromisso que alimenta as variáveis (mudou = conflito). */
export function eventVersion(eventId: string | null, updatedAt: Date | null): string | null {
  if (eventId === null) return null;
  return `${eventId}|${updatedAt ? updatedAt.toISOString() : '-'}`;
}

interface Entry {
  readonly contactId: string;
  readonly conversationId?: string | null;
  readonly eventId?: string | null;
  readonly eventStartAt?: Date | null;
}

function labelOf(displayName: string | null, profileName: string | null): string {
  const raw = (displayName ?? profileName ?? '').trim();
  const value = raw.length > 0 ? raw : 'Contato sem nome';
  return value.length > VISIBLE_LABEL_MAX ? `${value.slice(0, VISIBLE_LABEL_MAX - 1)}…` : value;
}

function scoped(...conds: (SQL | null | undefined)[]): SQL | undefined {
  return and(...conds.filter((c): c is SQL => c !== null && c !== undefined));
}

/** Variáveis usadas pelo conteúdo (texto ou valores das variáveis do modelo). */
export function usedVariables(args: SendMessagesArgs): MessageVariable[] {
  const texts = args.content.kind === 'text' ? [args.content.text] : args.content.variables;
  const used = new Set<MessageVariable>();
  for (const t of texts) for (const v of scanPlaceholders(t).used) used.add(v);
  return [...used];
}

function needsEvent(args: SendMessagesArgs): boolean {
  return usedVariables(args).some((v) => EVENT_VARIABLES.has(v));
}

// ─── Modelo (catálogo da F58) ─────────────────────────────────────────────────────

export interface TemplateRow {
  readonly id: string;
  readonly channelId: string;
  readonly name: string;
  readonly language: string;
  readonly category: string;
  readonly status: string;
  readonly isAvailable: boolean;
  readonly components: unknown[];
  readonly provider: string;
}

export async function loadTemplate(tx: DbTx, templateId: string): Promise<TemplateRow | null> {
  const [row] = await tx
    .select({
      id: channelMessageTemplates.id,
      channelId: channelMessageTemplates.channelId,
      name: channelMessageTemplates.name,
      language: channelMessageTemplates.language,
      category: channelMessageTemplates.category,
      status: channelMessageTemplates.status,
      isAvailable: channelMessageTemplates.isAvailable,
      components: channelMessageTemplates.components,
      provider: channels.provider,
    })
    .from(channelMessageTemplates)
    .innerJoin(channels, eq(channels.id, channelMessageTemplates.channelId))
    .where(eq(channelMessageTemplates.id, templateId))
    .limit(1);
  return row ?? null;
}

export function isTemplateApproved(t: TemplateRow): boolean {
  return t.status.toUpperCase() === 'APPROVED' && t.isAvailable && t.provider === 'meta_whatsapp';
}

/** Problema do modelo que impede o envio a QUALQUER destinatário (`null` = sem problema). */
export function templateProblem(t: TemplateRow | null, args: SendMessagesArgs): string | null {
  if (args.content.kind !== 'template') return null;
  if (t === null) return 'Modelo não encontrado no catálogo.';
  if (t.provider !== 'meta_whatsapp') return 'Modelos só existem no WhatsApp oficial.';
  if (!isTemplateApproved(t)) return `Modelo "${t.name}" não está aprovado (${t.status}).`;
  const parsed = parseTemplateComponents(t.components);
  if (parsed === null) return 'O modelo sincronizado está inválido. Sincronize os modelos.';
  if (parsed.header !== null && parsed.header.format !== 'TEXT') {
    return 'Modelo com mídia no cabeçalho: envie pela tela de campanhas.';
  }
  const dry = renderTemplate({
    name: t.name,
    language: t.language,
    components: t.components,
    bindings: bodyBindings(args.content.variables.map(() => 'x')),
    contact: null,
  });
  if (!dry.ok) return dry.issues[0]?.message ?? 'Variáveis do modelo não conferem.';
  return null;
}

function bodyBindings(values: readonly string[]): TemplateBinding[] {
  return values.map((value, i) => ({
    component: 'body',
    index: i + 1,
    source: { kind: 'fixed', value },
  }));
}

/**
 * Finalidade da mensagem (F59), por destinatário: decide o portão de consentimento aqui e no
 * worker (o job leva a mesma).
 * - Modelo: a categoria da Meta (`MARKETING` = marketing; utilidade/autenticação = transacional).
 * - Texto livre no WhatsApp oficial ou no Instagram: só sai dentro da janela de atendimento
 *   aberta PELO CONTATO (24 h) — é resposta a quem escreveu, transacional como o composer.
 * - Texto livre por canal sem janela de plataforma (WAHA) a 2+ pessoas é disparo: marketing
 *   (exige consentimento onde o mercado exige). A 1 pessoa, transacional.
 */
export function purposeFor(
  args: SendMessagesArgs,
  template: TemplateRow | null,
  recipientCount: number,
  provider: string | null,
): MessagePurpose {
  if (args.content.kind === 'template') {
    return (template?.category ?? '').toUpperCase() === 'MARKETING' ? 'marketing' : 'transactional';
  }
  if (provider === 'meta_whatsapp' || provider === 'meta_instagram') return 'transactional';
  return recipientCount >= 2 ? 'marketing' : 'transactional';
}

// ─── Resolução sob escopo ─────────────────────────────────────────────────────────

interface ContactRow {
  readonly id: string;
  readonly displayName: string | null;
  readonly profileName: string | null;
}

async function visibleContacts(
  ctx: ExecutorContext,
  ids: readonly string[],
): Promise<Map<string, ContactRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.tx
    .select({
      id: contacts.id,
      displayName: contacts.displayName,
      profileName: contacts.profileName,
    })
    .from(contacts)
    .where(
      scoped(
        eq(contacts.workspaceId, ctx.principal.workspaceId),
        inArray(contacts.id, [...ids]),
        isNull(contacts.deletedAt),
        contactScope(ctx.principal),
      ),
    );
  return new Map(rows.map((r) => [r.id, r]));
}

interface ConvRow {
  readonly id: string;
  readonly contactId: string | null;
  readonly channelId: string;
  readonly provider: string;
}

/** Conversas visíveis por id (as dicas do filtro/compromisso). */
async function visibleConversationsById(
  ctx: ExecutorContext,
  ids: readonly string[],
  channelId: string | null,
): Promise<Map<string, ConvRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.tx
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      channelId: conversations.channelId,
      provider: channels.provider,
    })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(
      scoped(
        eq(conversations.workspaceId, ctx.principal.workspaceId),
        inArray(conversations.id, [...ids]),
        inArray(channels.provider, [...MESSAGING_PROVIDERS]),
        channelId ? eq(conversations.channelId, channelId) : null,
        conversationScope(ctx.principal),
      ),
    );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Conversa visível mais recente de cada contato (num canal, se dado). */
async function latestVisibleConversation(
  ctx: ExecutorContext,
  contactIds: readonly string[],
  channelId: string | null,
): Promise<Map<string, ConvRow>> {
  if (contactIds.length === 0) return new Map();
  const rows = await ctx.tx
    .selectDistinctOn([conversations.contactId], {
      id: conversations.id,
      contactId: conversations.contactId,
      channelId: conversations.channelId,
      provider: channels.provider,
    })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(
      scoped(
        eq(conversations.workspaceId, ctx.principal.workspaceId),
        inArray(conversations.contactId, [...contactIds]),
        inArray(channels.provider, [...MESSAGING_PROVIDERS]),
        channelId ? eq(conversations.channelId, channelId) : null,
        conversationScope(ctx.principal),
      ),
    )
    .orderBy(
      conversations.contactId,
      sql`${conversations.lastMessageAt} desc nulls last`,
      desc(conversations.id),
    );
  const out = new Map<string, ConvRow>();
  for (const r of rows) if (r.contactId) out.set(r.contactId, r);
  return out;
}

interface EventRow {
  readonly id: string;
  readonly contactId: string | null;
  readonly conversationId: string | null;
  readonly title: string;
  readonly status: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly recurrenceRule: string | null;
  readonly recurrenceUntil: Date | null;
  readonly updatedAt: Date | null;
}

const eventColumns = {
  id: events.id,
  contactId: events.contactId,
  conversationId: events.conversationId,
  title: events.title,
  status: events.status,
  startAt: events.startAt,
  endAt: events.endAt,
  recurrenceRule: events.recurrenceRule,
  recurrenceUntil: events.recurrenceUntil,
  updatedAt: events.updatedAt,
};

async function accessibleCalendars(ctx: ExecutorContext): Promise<string[]> {
  return calendarRepo.accessibleCalendarIds(ctx.tx, {
    memberId: ctx.principal.memberId,
    role: ctx.principal.role,
  });
}

/** Compromissos não cancelados da janela, nas agendas que o membro vê (régua da agenda). */
async function eventEntries(
  ctx: ExecutorContext,
  filter: { readonly from: string; readonly to: string; readonly calendar_id?: string | undefined },
): Promise<Entry[]> {
  const from = new Date(filter.from);
  const to = new Date(filter.to);
  const accessible = await accessibleCalendars(ctx);
  let calendarIds = accessible;
  if (filter.calendar_id !== undefined) {
    if (!accessible.includes(filter.calendar_id)) return [];
    calendarIds = [filter.calendar_id];
  }
  if (calendarIds.length === 0) return [];
  const rows = await ctx.tx
    .select(eventColumns)
    .from(events)
    .innerJoin(calendars, eq(calendars.id, events.calendarId))
    .where(
      and(
        eq(events.workspaceId, ctx.principal.workspaceId),
        ne(events.status, 'cancelled'),
        isNotNull(events.contactId),
        inArray(events.calendarId, calendarIds),
        or(and(lte(events.startAt, to), gte(events.endAt, from)), isNotNull(events.recurrenceRule)),
      ),
    )
    .orderBy(asc(events.startAt), asc(events.id))
    .limit(EVENTS_SCAN_MAX);
  const occurrences = rows
    .flatMap((row) => expandOccurrences({ ...row, masterId: row.id }, from, to))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const byContact = new Map<string, Entry>();
  for (const o of occurrences) {
    if (!o.contactId || byContact.has(o.contactId)) continue;
    byContact.set(o.contactId, {
      contactId: o.contactId,
      conversationId: o.conversationId,
      eventId: o.masterId,
      eventStartAt: o.startAt,
    });
  }
  return [...byContact.values()];
}

/** Conversas da inbox que o membro vê, pela régua de `list_conversations`. */
async function conversationEntries(
  ctx: ExecutorContext,
  filter: Extract<SendMessagesArgs['filter'], { source: 'conversations' }>,
): Promise<Entry[]> {
  const now = ctx.now;
  const conds: (SQL | null)[] = [
    eq(conversations.workspaceId, ctx.principal.workspaceId),
    isNotNull(conversations.contactId),
    conversationScope(ctx.principal),
  ];
  const waiting = filter.status === 'waiting' || filter.waiting_minutes_gte !== undefined;
  if (waiting) {
    conds.push(inArray(conversations.status, [...OPEN_STATUSES]));
    conds.push(eq(conversations.lastMessageFrom, 'contact'));
  } else if (filter.status === 'open') {
    conds.push(inArray(conversations.status, [...OPEN_STATUSES]));
  }
  if (filter.status === 'resolved')
    conds.push(inArray(conversations.status, [...RESOLVED_STATUSES]));
  if (filter.waiting_minutes_gte !== undefined) {
    conds.push(
      lte(
        conversations.lastMessageAt,
        new Date(now.getTime() - filter.waiting_minutes_gte * 60_000),
      ),
    );
  }
  if (filter.assigned === 'me') conds.push(eq(conversations.assignedTo, ctx.principal.memberId));
  else if (filter.assigned === 'unassigned') conds.push(isNull(conversations.assignedTo));
  else if (filter.assigned !== undefined) conds.push(eq(conversations.assignedTo, filter.assigned));
  conds.push(
    inArray(
      channels.provider,
      filter.channel ? [...CHANNEL_PROVIDERS[filter.channel]] : [...MESSAGING_PROVIDERS],
    ),
  );
  const rows = await ctx.tx
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .innerJoin(channels, eq(channels.id, conversations.channelId))
    .where(scoped(...conds))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.id))
    // Um a mais que o teto: o motor recusa lote grande ("use a tela").
    .limit((BATCH_LIMIT + 1) * 2);
  const byContact = new Map<string, Entry>();
  for (const r of rows) {
    if (!r.contactId || byContact.has(r.contactId)) continue;
    byContact.set(r.contactId, { contactId: r.contactId, conversationId: r.id });
    if (byContact.size > BATCH_LIMIT) break;
  }
  return [...byContact.values()];
}

/** Próximo compromisso (não cancelado) de cada contato, nas agendas que o membro vê. */
async function nextEvents(
  ctx: ExecutorContext,
  contactIds: readonly string[],
): Promise<Map<string, EventRow>> {
  if (contactIds.length === 0) return new Map();
  const calendarIds = await accessibleCalendars(ctx);
  if (calendarIds.length === 0) return new Map();
  const until = new Date(ctx.now.getTime() + NEXT_EVENT_WINDOW_DAYS * DAY_MS);
  const rows = await ctx.tx
    .selectDistinctOn([events.contactId], eventColumns)
    .from(events)
    .where(
      and(
        eq(events.workspaceId, ctx.principal.workspaceId),
        inArray(events.contactId, [...contactIds]),
        inArray(events.calendarId, calendarIds),
        ne(events.status, 'cancelled'),
        gte(events.startAt, ctx.now),
        lte(events.startAt, until),
      ),
    )
    .orderBy(events.contactId, asc(events.startAt), asc(events.id));
  const out = new Map<string, EventRow>();
  for (const r of rows) if (r.contactId) out.set(r.contactId, r);
  return out;
}

export interface ResolvedRecipients {
  readonly targets: Target[];
  readonly dropped: { readonly id: string; readonly reason: 'not_found' }[];
}

/** Resolve os destinatários dos `args` sob o escopo do membro (proposta e ajuste). */
export async function resolveRecipientTargets(
  ctx: ExecutorContext,
  args: SendMessagesArgs,
): Promise<ResolvedRecipients> {
  let entries: Entry[];
  if (args.contact_ids) {
    entries = [...new Set(args.contact_ids)].map((contactId) => ({ contactId }));
  } else if (args.filter?.source === 'events') {
    entries = await eventEntries(ctx, args.filter);
  } else if (args.filter?.source === 'conversations') {
    entries = await conversationEntries(ctx, args.filter);
  } else {
    entries = [];
  }

  const template =
    args.content.kind === 'template' ? await loadTemplate(ctx.tx, args.content.template_id) : null;
  const channelId = template?.channelId ?? null;

  const contactRows = await visibleContacts(
    ctx,
    entries.map((e) => e.contactId),
  );
  const dropped = entries
    .filter((e) => !contactRows.has(e.contactId))
    .map((e) => ({ id: e.contactId, reason: 'not_found' as const }));
  const kept = entries.filter((e) => contactRows.has(e.contactId));

  const hinted = await visibleConversationsById(
    ctx,
    kept.flatMap((e) => (e.conversationId ? [e.conversationId] : [])),
    channelId,
  );
  const latest = await latestVisibleConversation(
    ctx,
    kept.map((e) => e.contactId),
    channelId,
  );

  // Compromisso: do filtro, ou o próximo do contato quando o texto usa horário/procedimento.
  const eventIds = kept.flatMap((e) => (e.eventId ? [e.eventId] : []));
  const eventRows = new Map<string, EventRow>();
  if (eventIds.length > 0) {
    const rows = await ctx.tx
      .select(eventColumns)
      .from(events)
      .where(and(eq(events.workspaceId, ctx.principal.workspaceId), inArray(events.id, eventIds)));
    for (const r of rows) eventRows.set(r.id, r);
  }
  const upcoming = needsEvent(args)
    ? await nextEvents(
        ctx,
        kept.filter((e) => !e.eventId).map((e) => e.contactId),
      )
    : new Map<string, EventRow>();

  const targets: Target[] = kept.map((e) => {
    const contact = contactRows.get(e.contactId);
    const hint = e.conversationId ? hinted.get(e.conversationId) : undefined;
    const hintOk = hint !== undefined && hint.contactId === e.contactId;
    const conversation = hintOk ? hint : latest.get(e.contactId);
    const ev = e.eventId ? (eventRows.get(e.eventId) ?? null) : (upcoming.get(e.contactId) ?? null);
    const startAt = e.eventStartAt ?? ev?.startAt ?? null;
    const state: RecipientState = {
      conversation_id: conversation?.id ?? null,
      event_id: ev?.id ?? null,
      event_start_at: startAt ? startAt.toISOString() : null,
    };
    return {
      type: 'contact',
      id: e.contactId,
      label: labelOf(contact?.displayName ?? null, contact?.profileName ?? null),
      expectedVersion: eventVersion(ev?.id ?? null, ev?.updatedAt ?? null),
      state,
    };
  });
  return { targets, dropped };
}

/**
 * Re-resolve contatos já conhecidos sob OUTRO principal (o aprovador). Visível = o contato está
 * no escopo e tem ao menos uma conversa que esse membro vê (a conversa exata é reconferida no
 * envio, sob as permissões de quem executa).
 */
export async function resolveRecipientIds(
  ctx: ExecutorContext,
  refs: readonly TargetRef[],
): Promise<ResolvedRecipients> {
  const ids = [...new Set(refs.filter((r) => r.type === 'contact').map((r) => r.id))];
  const contactRows = await visibleContacts(ctx, ids);
  const withConversation = await latestVisibleConversation(ctx, [...contactRows.keys()], null);
  const targets: Target[] = [];
  const dropped: { id: string; reason: 'not_found' }[] = [];
  for (const ref of refs) {
    const contact = ref.type === 'contact' ? contactRows.get(ref.id) : undefined;
    const conv = contact ? withConversation.get(ref.id) : undefined;
    if (!contact || !conv) {
      dropped.push({ id: ref.id, reason: 'not_found' });
      continue;
    }
    targets.push({
      type: 'contact',
      id: ref.id,
      label: labelOf(contact.displayName, contact.profileName),
      expectedVersion: null,
      state: { conversation_id: conv.id, event_id: null, event_start_at: null },
    });
  }
  return { targets, dropped };
}

// ─── Avaliação por destinatário ───────────────────────────────────────────────────

export type SkipKind =
  | 'no_conversation'
  | 'consent'
  | 'quiet_hours'
  | 'window_closed'
  | 'variable'
  | 'template'
  | 'unsupported_channel';

export interface RecipientSkip {
  readonly kind: SkipKind;
  /** Código estável para `error_code` (sem PII). */
  readonly code: string;
  /** Motivo legível para a pessoa ("sem consentimento"). */
  readonly reason: string;
}

export interface RecipientEvaluation {
  readonly targetId: string;
  readonly label: string;
  readonly conversationId: string | null;
  readonly provider: string | null;
  readonly purpose: MessagePurpose;
  /** Versão do compromisso lida agora (o executor confere contra a do item). */
  readonly eventVersion: string | null;
  readonly skip: RecipientSkip | null;
  /** Texto final (o que a pessoa lê na bolha). Presente quando não é pulado. */
  readonly text: string | null;
  /** Modelo com os parâmetros deste destinatário (só conteúdo de modelo). */
  readonly template: OutboundTemplate | null;
}

export interface WorkspaceContext {
  readonly market: MarketCode;
  readonly timezone: string;
  readonly locale: string;
}

export async function loadWorkspaceContext(
  tx: DbTx,
  workspaceId: string,
): Promise<WorkspaceContext> {
  const [row] = await tx
    .select({ market: workspaces.market, timezone: workspaces.timezone, locale: workspaces.locale })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return {
    market: row && isMarketCode(row.market) ? row.market : 'BR',
    timezone: row?.timezone ?? 'America/Sao_Paulo',
    locale: row?.locale ?? 'pt-BR',
  };
}

const CONSENT_REASON: Readonly<Record<OutboundDenyReason, string>> = {
  suppressed: 'pediu para não receber mensagens',
  no_consent: 'sem consentimento para marketing',
  quiet_hours: 'fora da janela de horário do contato',
  registration_pending: 'canal sem registro aprovado',
  channel_disabled: 'canal indisponível no mercado',
};

export interface EvaluationContext {
  readonly workspace: WorkspaceContext;
  readonly template: TemplateRow | null;
  readonly templateProblem: string | null;
  /** Destinatários avaliados juntos (decide a finalidade do texto livre fora da Meta). */
  readonly recipientCount: number;
}

/** Carrega o que vale para todos os destinatários (workspace, modelo, finalidade). */
export async function loadEvaluationContext(
  ctx: ExecutorContext,
  args: SendMessagesArgs,
  recipientCount: number,
): Promise<EvaluationContext> {
  const workspace = await loadWorkspaceContext(ctx.tx, ctx.principal.workspaceId);
  const template =
    args.content.kind === 'template' ? await loadTemplate(ctx.tx, args.content.template_id) : null;
  return {
    workspace,
    template,
    templateProblem: templateProblem(template, args),
    recipientCount,
  };
}

async function lastInboundByConversation(
  tx: DbTx,
  conversationIds: readonly string[],
): Promise<Map<string, Date>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await tx
    .select({
      conversationId: messages.conversationId,
      at: sql<Date>`max(${messages.createdAt})`.mapWith((v: string | Date) => new Date(v)),
    })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, [...conversationIds]),
        eq(messages.direction, 'inbound'),
      ),
    )
    .groupBy(messages.conversationId);
  return new Map(rows.map((r) => [r.conversationId, r.at]));
}

/**
 * Avalia os destinatários AGORA (prévia, política e confirmar). Uma consulta por tabela, mais
 * a checagem de consentimento por destinatário (`checkOutboundInTx`, a do caminho de envio).
 */
export async function evaluateRecipients(
  ctx: ExecutorContext,
  args: SendMessagesArgs,
  targets: readonly Target[],
  evalCtx?: EvaluationContext,
): Promise<{ readonly context: EvaluationContext; readonly items: RecipientEvaluation[] }> {
  const context = evalCtx ?? (await loadEvaluationContext(ctx, args, targets.length));
  const { workspace, template } = context;
  const states = new Map(targets.map((t) => [t.id, recipientStateOf(t.state)]));
  const contactRows = await visibleContacts(
    ctx,
    targets.map((t) => t.id),
  );
  const conversationsById = await visibleConversationsById(
    ctx,
    [...states.values()].flatMap((s) => (s.conversation_id ? [s.conversation_id] : [])),
    template?.channelId ?? null,
  );
  const inbound = await lastInboundByConversation(ctx.tx, [...conversationsById.keys()]);
  const eventIds = [...states.values()].flatMap((s) => (s.event_id ? [s.event_id] : []));
  const eventRows = new Map<string, EventRow>();
  if (eventIds.length > 0) {
    const rows = await ctx.tx
      .select(eventColumns)
      .from(events)
      .where(and(eq(events.workspaceId, ctx.principal.workspaceId), inArray(events.id, eventIds)));
    for (const r of rows) eventRows.set(r.id, r);
  }

  const items: RecipientEvaluation[] = [];
  for (const target of targets) {
    const state = states.get(target.id) ?? recipientStateOf(null);
    const contact = contactRows.get(target.id) ?? null;
    const conv = state.conversation_id
      ? (conversationsById.get(state.conversation_id) ?? null)
      : null;
    const ev = state.event_id ? (eventRows.get(state.event_id) ?? null) : null;
    const purpose = purposeFor(args, template, context.recipientCount, conv?.provider ?? null);
    const base = {
      targetId: target.id,
      label: target.label,
      conversationId: conv?.id ?? null,
      provider: conv?.provider ?? null,
      purpose,
      eventVersion: eventVersion(ev?.id ?? null, ev?.updatedAt ?? null),
    };
    const skipped = (skip: RecipientSkip): RecipientEvaluation => ({
      ...base,
      skip,
      text: null,
      template: null,
    });

    if (context.templateProblem !== null) {
      items.push(
        skipped({ kind: 'template', code: 'template_unavailable', reason: 'modelo indisponível' }),
      );
      continue;
    }
    if (!contact || !conv || conv.contactId !== target.id) {
      items.push(
        skipped({
          kind: 'no_conversation',
          code: 'no_conversation',
          reason: 'sem conversa que você vê',
        }),
      );
      continue;
    }
    if (!isChannelKind(conv.provider)) {
      items.push(
        skipped({
          kind: 'unsupported_channel',
          code: 'unsupported_channel',
          reason: 'canal sem envio',
        }),
      );
      continue;
    }

    // Consentimento e janela legal de horário (o portão da F59, por destinatário).
    const decision = await checkOutboundInTx(ctx.tx, {
      workspaceId: ctx.principal.workspaceId,
      contactId: target.id,
      channel: conv.provider,
      purpose,
      now: ctx.now,
    });
    if (!decision.allowed) {
      items.push(
        skipped({
          kind: decision.reason === 'quiet_hours' ? 'quiet_hours' : 'consent',
          code: decision.reason,
          reason: CONSENT_REASON[decision.reason],
        }),
      );
      continue;
    }

    // Janela de 24 h do provider: texto livre só com a conversa aberta.
    const window = windowFor(conv.provider, inbound.get(conv.id) ?? null, ctx.now);
    if (args.content.kind === 'text' && window !== null && !window.isOpen) {
      items.push(
        skipped({
          kind: 'window_closed',
          code: 'window_closed',
          reason: 'conversa fechada há mais de 24 h',
        }),
      );
      continue;
    }

    // Variáveis com os dados DESTE destinatário.
    const startAt = state.event_start_at ? new Date(state.event_start_at) : (ev?.startAt ?? null);
    const eventLive = ev !== null && ev.status !== 'cancelled';
    const values: VariableValues = {
      primeiro_nome: firstNameOf(contact.displayName ?? contact.profileName),
      hora: eventLive && startAt ? formatHour(startAt, workspace.timezone, workspace.locale) : null,
      data: eventLive && startAt ? formatDay(startAt, workspace.timezone, workspace.locale) : null,
      procedimento: eventLive ? ev.title : null,
    };

    if (args.content.kind === 'text') {
      const rendered = renderMessage(args.content.text, values);
      if (!rendered.ok) {
        items.push(
          skipped({
            kind: 'variable',
            code: `missing_${rendered.missing}`,
            reason: MISSING_VARIABLE_REASON[rendered.missing],
          }),
        );
        continue;
      }
      items.push({ ...base, skip: null, text: rendered.text, template: null });
      continue;
    }

    // Modelo: cada valor de variável é renderizado com os dados do destinatário.
    const resolved: string[] = [];
    let missing: MessageVariable | null = null;
    for (const raw of args.content.variables) {
      const r = renderMessage(raw, values);
      if (!r.ok) {
        missing = r.missing;
        break;
      }
      resolved.push(r.text);
    }
    if (missing !== null) {
      items.push(
        skipped({
          kind: 'variable',
          code: `missing_${missing}`,
          reason: MISSING_VARIABLE_REASON[missing],
        }),
      );
      continue;
    }
    const t = template;
    const out = t
      ? renderTemplate({
          name: t.name,
          language: t.language,
          components: t.components,
          bindings: bodyBindings(resolved),
          contact: null,
        })
      : null;
    if (!t || !out || !out.ok) {
      items.push(
        skipped({ kind: 'template', code: 'template_unavailable', reason: 'modelo indisponível' }),
      );
      continue;
    }
    items.push({
      ...base,
      skip: null,
      text: out.preview.body,
      template: {
        templateName: out.preview.outbound.templateName,
        languageCode: out.preview.outbound.languageCode,
        components: out.preview.outbound.components.map((c) => ({
          type: c.type,
          ...(c.sub_type !== undefined ? { sub_type: c.sub_type } : {}),
          ...(c.index !== undefined ? { index: c.index } : {}),
          parameters: c.parameters.map((p) => ({ type: p.type, text: p.text })),
        })),
      },
    });
  }
  return { context, items };
}

/** Corpo "com as variáveis marcadas" para a prévia (o texto do modelo, sem dados de ninguém). */
export function markedBody(args: SendMessagesArgs, template: TemplateRow | null): string {
  if (args.content.kind === 'text') return args.content.text;
  const parsed = template ? parseTemplateComponents(template.components) : null;
  if (!parsed) return '(modelo indisponível)';
  const values = new Map(args.content.variables.map((v, i) => [i + 1, v]));
  const body = parsed.body.replace(
    /\{\{\s*(\d+)\s*\}\}/gu,
    (whole, n: string) => values.get(Number(n)) ?? whole,
  );
  return body.trim().length > 0 ? body : '(modelo sem corpo)';
}
