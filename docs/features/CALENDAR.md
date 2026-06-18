# Feature — CALENDAR (Agendamentos)

> **Domínio:** Calendários, regras de disponibilidade, eventos, tools para agente IA marcar reunião
> **Pacotes:** `apps/api/src/routes/calendar`, `apps/web/features/calendar`, `packages/agents/src/tools/calendar`
> **Versão do modelo:** **2.0** (F37) — multi-calendário com visibilidade por membro, overlay estilo
> Google Calendar, recorrência simples e provisionamento automático. As seções 2.0 abaixo (esp. §0)
> têm precedência sobre o texto de MVP histórico que sobrou nas seções seguintes.

---

## 0. Calendar 2.0 (F37) — visibilidade, multi-calendário, recorrência

> Auditoria de privacidade desta entrega: `docs/audits/CALENDAR_V2_AUDIT.md`. Plano/levantamento:
> `docs/features/CALENDAR_V2_PLAN.md`.

### 0.1 Visibilidade por membro (privacidade) 🔒

Antes da 2.0, `GET /api/calendars` retornava **todos** os calendários do workspace e `GET /api/events`
sem filtro retornava **todos os eventos** — a RLS escopa por workspace, não por calendário, então um
membro comum via o pessoal de colegas (vazamento **L1**). A 2.0 escopa lista e eventos por
`calendarRepo.accessibleCalendarIds` (fonte de verdade) + `requireCalendarAccess` (ownership fino):

| Tipo de calendário | Quem vê |
|---|---|
| `workspace` ("Empresa") | **todos** os membros do workspace |
| `personal` | o **dono** (`owner_id`); **OWNER/ADMIN** veem **todos** os pessoais; **SUPERVISOR** vê os pessoais dos integrantes dos times que **lidera** (`team_members.role='lead'`) |
| `team` | membros do time (`team_members`, F8) + SUPERVISOR dos times que lidera |

`accessibleCalendarIds` (`packages/db/src/repos/calendar.ts`) resolve esse conjunto sob a transação
RLS-escopada. As listas usam `inArray(events.calendarId, accessibleIds)`; o overlay `calendarIds`
é a **interseção** entre o pedido e o acessível (um id inacessível é silenciosamente descartado).

> **⚠️ Pendência conhecida (ver auditoria §4):** `GET /api/events/:id` ainda **não** intersecta com
> `accessibleCalendarIds` — vaza o detalhe (read-only) de eventos de calendários inacessíveis. Fix
> previsto no slot dono (S02). Mutações (PUT/cancel/RSVP) **estão** protegidas por `canMutateEvent`.

### 0.2 Multi-calendário & overlay (UI)

Trilha lateral (estilo Google Calendar, DS v2) com grupos **Meu calendário · Empresa · Times ·
(OWNER/ADMIN) Pessoas**. Cada item é uma linha-checkbox com **cor própria** (`calendars.color`,
DATA da API — nunca hex literal em JSX) e liga/desliga independente; vários calendários sobrepostos
ao mesmo tempo. A seleção persiste **por membro** em `localStorage` (`hm:calendar:selection:<memberId>`)
para não vazar entre contas no mesmo browser. Eventos coloridos pelo calendário de origem + legenda.
Default **semana** (timeGrid); arraste-pra-criar, arraste-pra-mover e redimensionar (só para quem
pode editar o evento: criador ou admin). Mobile: a trilha vira **sheet** (F37-S04), reconciliando a
agenda mobile (F36-S07).

### 0.3 Provisionamento automático

`GET /api/calendars` provisiona de forma **lazy e idempotente** (no primeiro acesso de cada membro):
- **1 calendário `personal`** por membro (`ensurePersonalCalendar`, identidade `(workspace, personal, owner_id)`),
- **1 calendário `workspace`** "Empresa" default (`ensureWorkspaceCalendar`, identidade `(workspace, workspace)`).

Evento criado sem `calendarId` cai no **pessoal do criador** (o event-service resolve/provisiona).

### 0.4 Recorrência (RRULE simplificado)

Eventos podem repetir via `recurrenceRule` + `recurrenceUntil`. Gramática aceita (`calendar-recurrence.ts`):

```
FREQ=DAILY|WEEKLY[;INTERVAL=n][;BYDAY=MO,WE,...][;UNTIL=ISO]
```

O **mestre** persiste a regra; `GET /api/events` com janela `from`/`to` **expande** a série em
ocorrências virtuais com id sintético `evt:<masterId>:<startISO>` (`recurrenceParentId` aponta o
mestre). Sem janela definida, séries abertas **não** são materializadas (devolve só o mestre).
Abrir/editar/mover uma ocorrência opera sobre o **mestre** (edição de série na v1 — documentado).
O form 2.0 expõe presets (Não se repete · Todos os dias · Toda semana · Dias úteis · Dias específicos)
+ "Repetir até". `BYDAY` inválido ou `FREQ` não suportado → **400** na API.

### 0.5 Endpoints 2.0 (delta sobre §7)

- `GET /api/calendars` — provisiona pessoal+Empresa e lista **só os acessíveis** (filtro `?type=`).
- `GET /api/events?calendarIds=a,b&from=&to=&contact=` — escopado por acessíveis; `calendarIds` CSV
  ou repetido = overlay; recorrência expandida na janela. `calendar` (singular, legado) ainda aceito.
- `POST`/`PUT /api/events` — aceitam `recurrenceRule`/`recurrenceUntil`.

---

## 1. Conceito

Sistema de agendamento interno permite:
- Cada membro do workspace ter calendário pessoal.
- Definir regras de disponibilidade por dia da semana.
- Exceções (férias, bloqueios pontuais).
- Eventos com participantes (member + contact).
- Agente IA marcar reuniões via tools `list_calendars`, `get_available_slots`, `schedule_event`.

**Não inclui no MVP:** sync Google Calendar/Outlook, meeting link auto-gen (Zoom/Jitsi).

---

## 2. Modelo de dados (resumo, completo em DATA_MODEL.md §12)

- `calendars` (personal/team/workspace)
- `availability_rules` (por member + day_of_week + start_time + end_time)
- `availability_exceptions` (períodos de bloqueio/disponibilidade)
- `events` (start_at, end_at, type, FKs opcionais para contact/deal/conversation)
- `event_participants` (member ou contact)

---

## 3. Cálculo de slots disponíveis

### 3.1 Função PL/pgSQL `compute_available_slots`

> **⚠️ Histórico — superado pela migration (gotcha F7).** O SQL abaixo é o **rascunho do spec**.
> A função realmente aplicada vive na migration de F7 (corrige o bug do spec, ver memória
> `tagix-f7-decomposition`). Use a migration como fonte de verdade; este bloco fica só como
> referência de intenção (buffer, min-notice, timezone do workspace).

Replica + melhora do v1 (`020_compute_available_slots.sql`):

```sql
CREATE OR REPLACE FUNCTION compute_available_slots(
  p_workspace_id uuid,
  p_member_id uuid,
  p_date date,
  p_interval_minutes integer DEFAULT 60,
  p_min_notice_minutes integer DEFAULT 30,
  p_buffer_minutes integer DEFAULT 15,         -- NOVO no v2: buffer entre eventos
  p_max_slots integer DEFAULT 10
)
RETURNS TABLE (start_at timestamptz, end_at timestamptz, duration_minutes integer)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tz text;
  v_dow integer;
  v_now timestamptz := now();
BEGIN
  -- 1. Timezone do member (via workspace fallback)
  SELECT w.timezone INTO v_tz
  FROM workspaces w
  WHERE w.id = p_workspace_id;

  -- 2. Day of week (PG: 0=Sunday)
  v_dow := EXTRACT(DOW FROM (p_date AT TIME ZONE v_tz));

  RETURN QUERY
  WITH rules AS (
    SELECT
      ar.start_time,
      ar.end_time
    FROM availability_rules ar
    WHERE ar.member_id = p_member_id
      AND ar.day_of_week = v_dow
      AND ar.is_active = true
      AND ar.is_available = true
  ),
  base_slots AS (
    SELECT
      gs.slot_start::timestamptz AS start_at,
      (gs.slot_start + (p_interval_minutes || ' minutes')::interval)::timestamptz AS end_at
    FROM rules r,
      LATERAL generate_series(
        (p_date::timestamptz + r.start_time) AT TIME ZONE v_tz,
        ((p_date::timestamptz + r.end_time) AT TIME ZONE v_tz) - (p_interval_minutes || ' minutes')::interval,
        (p_interval_minutes || ' minutes')::interval
      ) AS gs(slot_start)
  ),
  not_in_exception AS (
    SELECT bs.*
    FROM base_slots bs
    WHERE NOT EXISTS (
      SELECT 1 FROM availability_exceptions ae
      WHERE ae.member_id = p_member_id
        AND ae.is_available = false
        AND tsrange(
          (ae.start_date::timestamptz + COALESCE(ae.start_time, '00:00')) AT TIME ZONE v_tz,
          (ae.end_date::timestamptz + COALESCE(ae.end_time, '23:59')) AT TIME ZONE v_tz
        ) && tsrange(bs.start_at, bs.end_at)
    )
  ),
  not_conflicting AS (
    SELECT nie.*
    FROM not_in_exception nie
    WHERE NOT EXISTS (
      SELECT 1 FROM events e
      JOIN event_participants ep ON ep.event_id = e.id
      WHERE ep.member_id = p_member_id
        AND e.status != 'cancelled'
        AND tsrange(
          e.start_at - (p_buffer_minutes || ' minutes')::interval,
          e.end_at + (p_buffer_minutes || ' minutes')::interval
        ) && tsrange(nie.start_at, nie.end_at)
    )
  )
  SELECT
    nc.start_at,
    nc.end_at,
    p_interval_minutes AS duration_minutes
  FROM not_conflicting nc
  WHERE nc.start_at >= v_now + (p_min_notice_minutes || ' minutes')::interval
  ORDER BY nc.start_at
  LIMIT p_max_slots;
END;
$$;
```

Melhorias vs v1:
- Buffer entre eventos (default 15min cleanup) — novo.
- Min notice obrigatório (default 30min) — mantido.
- Timezone do workspace (não hardcoded).
- Indexes em `events(member_id, start_at)` aproveitados.

---

## 4. Tools para Agente IA

### 4.1 `list_calendars`

```ts
// packages/agents/src/tools/calendar/listCalendars.tool.ts
const schema = z.object({
  ownerMemberId: z.string().uuid().optional(),
  type: z.enum(['personal','team','workspace']).optional(),
});

export const listCalendarsTool: ToolDefinition<z.infer<typeof schema>> = {
  key: 'list_calendars',
  name: 'Listar calendários',
  description: 'Retorna calendários disponíveis no workspace, com seus IDs e nomes.',
  category: 'calendar',
  schema,
  async handler(args, ctx) {
    const rows = await db.calendars.findMany({
      where: and(
        eq(calendars.workspaceId, ctx.workspaceId),
        args.ownerMemberId ? eq(calendars.ownerId, args.ownerMemberId) : undefined,
        args.type ? eq(calendars.type, args.type) : undefined,
      ),
      orderBy: [desc(calendars.isDefault), asc(calendars.name)],
      limit: 20,
    });
    return { calendars: rows.map(c => ({ id: c.id, name: c.name, type: c.type, isDefault: c.isDefault })) };
  },
};
```

### 4.2 `get_available_slots`

```ts
const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  memberId: z.string().uuid().optional(),
  calendarId: z.string().uuid().optional(),
  intervalMinutes: z.number().min(15).max(240).default(60),
  minNoticeMinutes: z.number().min(0).default(30),
  bufferMinutes: z.number().min(0).default(15),
  maxSlots: z.number().min(1).max(50).default(10),
});

export const getAvailableSlotsTool: ToolDefinition<z.infer<typeof schema>> = {
  key: 'get_available_slots',
  name: 'Buscar horários disponíveis',
  description: 'Retorna horários disponíveis em determinada data, respeitando regras de disponibilidade e conflitos.',
  category: 'calendar',
  schema,
  async handler(args, ctx) {
    // resolve memberId (do calendar.owner_id ou default)
    let memberId = args.memberId;
    if (!memberId && args.calendarId) {
      const cal = await db.calendars.findFirst({ where: eq(calendars.id, args.calendarId) });
      memberId = cal?.ownerId ?? undefined;
    }
    if (!memberId) {
      const defaultCal = await db.calendars.findFirst({
        where: and(eq(calendars.workspaceId, ctx.workspaceId), eq(calendars.isDefault, true)),
      });
      memberId = defaultCal?.ownerId;
    }
    if (!memberId) throw new ToolError('Nenhum calendar default encontrado');

    const slots = await db.execute(sql`
      SELECT * FROM compute_available_slots(
        ${ctx.workspaceId}::uuid,
        ${memberId}::uuid,
        ${args.date}::date,
        ${args.intervalMinutes}::integer,
        ${args.minNoticeMinutes}::integer,
        ${args.bufferMinutes}::integer,
        ${args.maxSlots}::integer
      )
    `);
    return { slots: slots.rows };
  },
};
```

### 4.3 `schedule_event`

```ts
const schema = z.object({
  title: z.string().min(2),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  calendarId: z.string().uuid().optional(),
  type: z.enum(['meeting','demo','follow_up','task','reminder','other']).default('meeting'),
  description: z.string().optional(),
  location: z.string().optional(),
  meetingUrl: z.string().url().optional(),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

export const scheduleEventTool: ToolDefinition<z.infer<typeof schema>> = {
  key: 'schedule_event',
  name: 'Agendar evento',
  description: 'Cria um evento no calendário com início, fim e participantes. SEMPRE chame get_available_slots antes para validar disponibilidade.',
  category: 'calendar',
  schema,
  config: { requiresHumanApproval: false },
  async handler(args, ctx) {
    if (ctx.isPlayground) {
      return { success: true, simulated: true, event: { ...args, id: 'sim-' + ctx.executionId } };
    }

    // pick calendarId: arg > contact_owner > workspace default
    let calendarId = args.calendarId;
    if (!calendarId && ctx.contactId) {
      // ... resolve via contact.owner_id
    }
    if (!calendarId) {
      const defaultCal = await db.calendars.findFirst({
        where: and(eq(calendars.workspaceId, ctx.workspaceId), eq(calendars.isDefault, true)),
      });
      calendarId = defaultCal?.id;
    }
    if (!calendarId) throw new ToolError('Nenhum calendar disponível');

    const [event] = await db.events.insert({
      workspaceId: ctx.workspaceId,
      calendarId,
      title: args.title,
      type: args.type,
      startAt: args.startAt,
      endAt: args.endAt,
      description: args.description,
      location: args.location,
      meetingUrl: args.meetingUrl,
      contactId: args.contactId ?? ctx.contactId,
      dealId: args.dealId,
      conversationId: args.conversationId ?? ctx.conversationId,
      createdByAgentId: ctx.agentId,
      status: 'scheduled',
    }).returning();

    // participants
    const cal = await db.calendars.findFirst({ where: eq(calendars.id, calendarId) });
    if (cal?.ownerId) {
      await db.eventParticipants.insert({ eventId: event.id, memberId: cal.ownerId, role: 'organizer' });
    }
    if (event.contactId) {
      await db.eventParticipants.insert({ eventId: event.id, contactId: event.contactId, role: 'attendee' });
    }

    // notify
    await dispatchEventNotifications(event);

    return { success: true, event: { id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt } };
  },
};
```

### 4.4 Fluxo conversacional típico

```
Cliente: "Quero marcar uma reunião"
  ↓
Agente reasoning: "Preciso saber quando o cliente prefere e quem é o member responsável"
  ↓
Agente call: list_calendars()
  ↓
Agente: "Posso agendar contigo. Qual data você prefere?"
  ↓
Cliente: "Quinta-feira"
  ↓
Agente call: get_available_slots(date='2026-06-11', interval=60)
  ↓
Resposta: slots [9h, 10h, 11h, 14h, 15h, 16h]
  ↓
Agente: "Tenho disponível 9h, 10h, 11h, 14h, 15h, 16h. Qual prefere?"
  ↓
Cliente: "10h"
  ↓
Agente call: schedule_event(title='Reunião com [Nome]', startAt='2026-06-11T10:00-03:00', endAt='2026-06-11T11:00-03:00', contactId='<atual>')
  ↓
Resposta: { success: true, event: {...} }
  ↓
Agente: "Pronto! Agendei pra quinta às 10h. Vou te lembrar 1 dia antes."
```

---

## 5. UI

### 5.1 CalendarPage

- FullCalendar com views: month, week, day.
- Selector de calendar (próprio, time, workspace).
- Click em horário vazio → modal de criação.
- Click em evento → modal de detalhe + ações (editar, cancelar).

### 5.2 EventForm

- Título, descrição, tipo
- Date pickers para start/end
- Calendar selector
- Participantes (member picker + contact picker)
- Localização + meeting URL opcional
- Lembretes (X min antes via notification system)

### 5.3 AvailabilityRulesPage (settings → calendar)

- Por dia da semana, definir janela(s) de disponibilidade.
- Quick presets: "Horário comercial (Seg-Sex 9-18)", "Tarde apenas (14-18)".
- Adicionar exceções (data específica disabled).

---

## 6. Notificações

- **Lembrete pra organizador:** 1 dia antes, 1h antes (configurável).
- **Lembrete pra contact:** mensagem WhatsApp via channel padrão do workspace.
- **Cancellation:** todos os participantes notificados.

Implementado via job `event_reminders` (scheduler 5min) que busca `events.start_at - reminder_offset <= now()` e dispatcha notification + opcional outbound WhatsApp.

---

## 7. API

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/calendars` | Lista calendários do workspace |
| POST | `/api/calendars` | Cria calendar |
| GET | `/api/calendars/:id` | Detalhe |
| PUT | `/api/calendars/:id` | Update |
| DELETE | `/api/calendars/:id` | Remove |
| GET | `/api/calendars/:id/events` | Lista eventos |
| GET | `/api/availability/rules` | Lista regras do member logado |
| PUT | `/api/availability/rules` | Update bulk |
| GET | `/api/availability/exceptions` | Lista exceções |
| POST | `/api/availability/exceptions` | Cria exceção |
| DELETE | `/api/availability/exceptions/:id` | Remove |
| GET | `/api/availability/slots?memberId=&date=&interval=` | Wrapper REST de `compute_available_slots` |
| GET | `/api/events` | Lista (filtros: calendar, date range, contact) |
| POST | `/api/events` | Cria |
| GET | `/api/events/:id` | Detalhe |
| PUT | `/api/events/:id` | Update |
| POST | `/api/events/:id/cancel` | Cancela |
| POST | `/api/events/:id/rsvp` | RSVP |

---

## 8. Permissões

| Ação | Quem pode |
|---|---|
| Ver calendar pessoal | dono + ADMIN/OWNER |
| Ver calendar de team | members do team + SUPERVISOR+ |
| Ver calendar workspace | todos os members |
| Criar event em calendar pessoal | dono + ADMIN/OWNER + agente (se tool habilitada) |
| Editar event | criador + ADMIN/OWNER |
| Cancelar event | criador + ADMIN/OWNER + organizer |
| Definir availability_rules | dono do member + ADMIN/OWNER |

Middleware `requireCalendarAccess` chamado em rotas relevantes.

---

## 9. Não-objetivos MVP

- Google Calendar sync (CalDAV): fase 2.
- Outlook sync: fase 2.
- ~~Recurring events (RRULE): fase 2 — MVP só single events.~~ **Entregue na 2.0 (F37)** — RRULE
  simplificado (DAILY/WEEKLY + BYDAY + UNTIL), expandido na janela. Ver §0.4.
- Meeting URL auto-gen (Jitsi/Zoom integration): fase 2.
- Booking page pública (Calendly-like com URL compartilhável): fase 2.
- Multi-timezone display per attendee: fase 2.

---

## 10. Métricas

- Agendamentos via agente IA / dia (métrica de adoção).
- Slot computation P95 < 100ms.
- No-show rate (events `status='scheduled'` que passaram sem `confirmed`): métrica de saúde.

---

## 11. Riscos

| Risco | Mitigation |
|---|---|
| Conflito de evento (dois marcados ao mesmo tempo) | `get_available_slots` SEMPRE chamado antes; race acceptable (raro); UI mostra warning se conflito |
| Timezone confuso entre member e contact | Sempre persistir UTC; converter para timezone do member na display; em conversa, perguntar timezone do contact se diferir |
| Slot computation lento com muitas regras | Indexes em `availability_rules(member_id, day_of_week)`, `events(member_id, start_at)`; cache 30s |
