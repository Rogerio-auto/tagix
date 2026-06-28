/**
 * Repo do Calendar 2.0 (F37-S01): provisionamento de calendarios + helper de acesso.
 *
 * Todas as funcoes recebem o `DbTx` de uma transacao RLS-escopada (`withWorkspace`)
 * — nunca abrem o proprio escopo. Isso mantem o isolamento por workspace consistente
 * com o resto do DAL (espelha agent_departments). Consumido por S02 (lista/eventos
 * escopados, fechando o vazamento L1 da auditoria) e pela criacao de membros (L2).
 *
 * `accessibleCalendarIds` espelha e ESTENDE `canAccessCalendar`
 * (apps/api/src/middlewares/calendar-access.ts): a regra de `team` deixa de ser
 * "managers only" e passa a usar `team_members` (F8) — o membro ve os calendarios
 * dos times a que pertence; o SUPERVISOR ve adicionalmente os times que LIDERA
 * (role='lead') e os pessoais dos integrantes desses times; OWNER/ADMIN veem todos
 * os pessoais do workspace.
 */
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Role } from '@hm/shared';
import type { DbTx } from '../client';
import { calendars, eventParticipants, events, teamMembers } from '../schema';

export type Calendar = typeof calendars.$inferSelect;

/** Linha completa de um evento (igual ao $inferSelect do schema). */
export type Event = typeof events.$inferSelect;

/** Prioridade do compromisso (F53). Espelha `events_priority_chk`. */
export type EventPriority = 'low' | 'medium' | 'high';

/** Contexto do membro p/ resolver visibilidade de calendarios. */
export interface CalendarAccessContext {
  memberId: string;
  role: Role;
}

/**
 * Calendar de destino inexistente no workspace. Erro de DOMINIO do repo — o caller
 * (API/worker) decide como mapear (a API → EventServiceError 404). Mantemos o repo
 * agnostico de HTTP: ele so sinaliza a condicao.
 */
export class CalendarNotFoundError extends Error {
  constructor(message = 'Calendar inexistente no workspace.') {
    super(message);
    this.name = 'CalendarNotFoundError';
  }
}

/**
 * Entrada de criacao de evento — FONTE UNICA de persistencia (API e worker).
 *
 * `createdBy`/`createdByAgentId` ja vem RESOLVIDOS pelo caller (a API deriva do
 * `actor`; o worker passa o agente/automacao). O repo NAO conhece o conceito de
 * "actor" e NAO valida range (responsabilidade do caller). Resolucao de calendar:
 *  - `calendarId` presente → precisa existir no workspace (RLS ja isola), senao
 *    `CalendarNotFoundError`.
 *  - `calendarId` ausente → default = calendario "Empresa" (workspace), provisionado
 *    on-demand via `ensureWorkspaceCalendar`.
 */
export interface CreateEventInput {
  readonly workspaceId: string;
  readonly calendarId?: string | null;
  readonly title: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly type?: Event['type'];
  /** Prioridade do compromisso (F53). Ausente → default 'medium' (igual à coluna). */
  readonly priority?: EventPriority;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly meetingUrl?: string | null;
  readonly contactId?: string | null;
  readonly dealId?: string | null;
  readonly conversationId?: string | null;
  readonly metadata?: Record<string, unknown>;
  /** Members extras a participar (além do organizer = dono do calendar). */
  readonly memberIds?: readonly string[];
  /** Recorrência (RRULE simplificado) — persistida; expansão é na query da API. */
  readonly recurrenceRule?: string | null;
  readonly recurrenceUntil?: Date | null;
  /** Resolvido pelo caller (member criador). */
  readonly createdBy?: string | null;
  /** Resolvido pelo caller (agente criador). */
  readonly createdByAgentId?: string | null;
}

const ADMIN_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'ADMIN']);

export const calendarRepo = {
  /**
   * Cria (ou retorna, se ja existir) o calendario `personal` do membro. Idempotente:
   * a chave de identidade e (workspace, type='personal', owner_id=member). Chamar de
   * novo retorna a mesma linha sem inserir duplicata.
   *
   * Roda sob a transacao RLS-escopada -> o `workspace_id` ja esta isolado; passamos
   * `workspaceId` explicito para o INSERT (a policy WITH CHECK exige casar).
   */
  async ensurePersonalCalendar(
    tx: DbTx,
    workspaceId: string,
    memberId: string,
    name = 'Meu calendário',
  ): Promise<Calendar> {
    const [existing] = await tx
      .select()
      .from(calendars)
      .where(and(eq(calendars.type, 'personal'), eq(calendars.ownerId, memberId)))
      .limit(1);
    if (existing) return existing;

    const [created] = await tx
      .insert(calendars)
      .values({ workspaceId, name, type: 'personal', ownerId: memberId })
      .returning();
    if (!created) throw new Error('Falha ao provisionar calendário pessoal.');
    return created;
  },

  /**
   * Cria (ou retorna) o calendario "Empresa" (`type='workspace'`, isDefault) do
   * workspace. Idempotente pela identidade (workspace, type='workspace'). Se ja
   * houver um workspace-calendar (ex.: seed-demo), retorna-o em vez de duplicar.
   */
  async ensureWorkspaceCalendar(
    tx: DbTx,
    workspaceId: string,
    name = 'Empresa',
  ): Promise<Calendar> {
    const [existing] = await tx
      .select()
      .from(calendars)
      .where(eq(calendars.type, 'workspace'))
      .limit(1);
    if (existing) return existing;

    const [created] = await tx
      .insert(calendars)
      .values({ workspaceId, name, type: 'workspace', isDefault: true })
      .returning();
    if (!created) throw new Error('Falha ao provisionar calendário da empresa.');
    return created;
  },

  /**
   * IDs dos calendarios visiveis ao membro DENTRO do workspace corrente (RLS ja
   * escopa por workspace). Conjunto:
   *  - workspace        -> todos (visivel a qualquer membro do workspace).
   *  - personal proprio -> owner_id = member.
   *  - team             -> times a que o membro pertence (`team_members`).
   *  - OWNER/ADMIN      -> + TODOS os pessoais do workspace.
   *  - SUPERVISOR       -> + times que LIDERA (role='lead') e os pessoais dos
   *                        integrantes desses times.
   *
   * Retorna ids unicos. Pensado p/ alimentar `inArray(events.calendarId, ids)` no S02.
   */
  async accessibleCalendarIds(tx: DbTx, ctx: CalendarAccessContext): Promise<string[]> {
    const { memberId, role } = ctx;

    // Times a que o membro pertence + times que lidera (role='lead').
    const memberships = await tx
      .select({ teamId: teamMembers.teamId, teamRole: teamMembers.role })
      .from(teamMembers)
      .where(eq(teamMembers.memberId, memberId));

    const memberTeamIds = memberships.map((m) => m.teamId);
    const ledTeamIds = memberships.filter((m) => m.teamRole === 'lead').map((m) => m.teamId);

    // Times cujos calendarios o membro pode ver: os que participa SEMPRE; e, se
    // SUPERVISOR, tambem os que lidera (subconjunto, mas explicito p/ clareza).
    const visibleTeamIds =
      role === 'SUPERVISOR'
        ? Array.from(new Set([...memberTeamIds, ...ledTeamIds]))
        : memberTeamIds;

    // Pessoais que o supervisor ve por liderar um time: dos integrantes desses times.
    let supervisedPersonalOwnerIds: string[] = [];
    if (role === 'SUPERVISOR' && ledTeamIds.length > 0) {
      const supervised = await tx
        .selectDistinct({ memberId: teamMembers.memberId })
        .from(teamMembers)
        .where(inArray(teamMembers.teamId, ledTeamIds));
      supervisedPersonalOwnerIds = supervised.map((s) => s.memberId);
    }

    // Predicado: workspace OU (personal proprio/admin/supervisionado) OU (team visivel).
    const isAdmin = ADMIN_ROLES.has(role);

    const personalPredicate = isAdmin
      ? // OWNER/ADMIN veem todos os pessoais.
        and(eq(calendars.type, 'personal'), isNotNull(calendars.ownerId))
      : (() => {
          const owners = Array.from(new Set([memberId, ...supervisedPersonalOwnerIds]));
          return and(eq(calendars.type, 'personal'), inArray(calendars.ownerId, owners));
        })();

    const teamPredicate =
      visibleTeamIds.length > 0
        ? and(eq(calendars.type, 'team'), inArray(calendars.teamId, visibleTeamIds))
        : // nenhum time visivel -> predicado sempre-falso (mantem o OR bem-formado).
          sql`false`;

    const rows = await tx
      .select({ id: calendars.id })
      .from(calendars)
      .where(or(eq(calendars.type, 'workspace'), personalPredicate, teamPredicate));

    return Array.from(new Set(rows.map((r) => r.id)));
  },

  /**
   * Cria um evento + seus participantes — NUCLEO UNICO de persistencia, reusado
   * pela API (event-service) e pelo worker (automacao F53-S07). NAO valida range
   * nem dispara seam (isso fica client-side da API). Roda sob a transacao RLS-escopada.
   *
   * Participantes: organizer = dono do calendar (`owner_id`); attendees = `memberIds`
   * extras (deduplicados do organizer) + o `contactId` (se houver). Espelha 1:1 o
   * comportamento que vivia no `event-service.createEvent`.
   */
  async createEvent(tx: DbTx, input: CreateEventInput): Promise<Event> {
    // Resolve o calendar de destino. Ausente → default = "Empresa" (workspace),
    // provisionado on-demand (idempotente). Presente → precisa existir (RLS isola).
    let calendarId = input.calendarId ?? null;
    if (!calendarId) {
      const wsCalendar = await this.ensureWorkspaceCalendar(tx, input.workspaceId);
      calendarId = wsCalendar.id;
    }

    const [calendar] = await tx
      .select({ id: calendars.id, ownerId: calendars.ownerId })
      .from(calendars)
      .where(eq(calendars.id, calendarId));
    if (!calendar) {
      throw new CalendarNotFoundError();
    }

    const [event] = await tx
      .insert(events)
      .values({
        workspaceId: input.workspaceId,
        calendarId: calendar.id,
        title: input.title,
        type: input.type ?? 'meeting',
        startAt: input.startAt,
        endAt: input.endAt,
        status: 'scheduled',
        priority: input.priority ?? 'medium',
        description: input.description ?? null,
        location: input.location ?? null,
        meetingUrl: input.meetingUrl ?? null,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        conversationId: input.conversationId ?? null,
        createdBy: input.createdBy ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        recurrenceRule: input.recurrenceRule ?? null,
        recurrenceUntil: input.recurrenceUntil ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    if (!event) throw new Error('Falha ao criar evento.');

    // Participantes: organizer (dono do calendar) + extras + contact attendee.
    const organizerIds = new Set<string>();
    if (calendar.ownerId) organizerIds.add(calendar.ownerId);
    const extraMembers = (input.memberIds ?? []).filter((m) => !organizerIds.has(m));

    const participantValues: (typeof eventParticipants.$inferInsert)[] = [];
    for (const memberId of organizerIds) {
      participantValues.push({ eventId: event.id, memberId, role: 'organizer' });
    }
    for (const memberId of extraMembers) {
      participantValues.push({ eventId: event.id, memberId, role: 'attendee' });
    }
    if (input.contactId) {
      participantValues.push({ eventId: event.id, contactId: input.contactId, role: 'attendee' });
    }
    if (participantValues.length > 0) {
      await tx.insert(eventParticipants).values(participantValues);
    }

    return event;
  },
};
