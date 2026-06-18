# Calendar 2.0 — Multi-calendário + Visibilidade + UX rica — Levantamento & Plano

> **Data:** 2026-06-17
> **Origem:** founder — gestão de calendário mais abrangente, igual ao sistema antigo: **calendário pessoal** (cada um vê o seu) **+ calendário da empresa**, com o **owner ("Warner") vendo o de todo mundo**; agendamento mais rico ("marcar diferentes horários"); **UI/UX bem mais trabalhada e interativa**, dentro do DS v2.
> **Status:** levantamento + plano para **aprovação**; decomposição em slots (proposta **F37**) após o OK.

---

## 1. TL;DR

A **fundação já existe** no banco e no modelo de acesso — só não está exposta. O schema tem `calendars` com `type = personal | team | workspace` + `owner_id` + `color`, e o middleware `canAccessCalendar` já diz: pessoal → dono **+ OWNER/ADMIN** (o "Warner" já enxerga o de todos), workspace → todos, team → managers. O que falta é (a) **aplicar essa visibilidade na lista e na query de eventos** (hoje não é — e isso vaza dados), (b) **provisionar um calendário pessoal por membro + um "Empresa"**, e (c) construir a **UX multi-calendário** estilo Google Calendar (trilha lateral de calendários com cor + liga/desliga, overlay, agendamento por arraste), tudo no DS v2.

---

## 2. Levantamento — o que JÁ existe

| Capacidade | Estado | Evidência |
|---|---|---|
| Schema multi-calendário (`personal/team/workspace`, owner, color, isDefault) | ✅ | `packages/db/src/schema/calendar.ts` |
| Eventos por calendário + participantes + RSVP + availability | ✅ | mesma + `event_participants` |
| Modelo de acesso fino (`canAccessCalendar`) | ✅ | `apps/api/src/middlewares/calendar-access.ts` |
| API: calendars CRUD, events CRUD/cancel/rsvp, availability, slots | ✅ | `routes/calendar/*` |
| Perms `calendar.view`(ALL)/`calendar.manage`(MANAGERS)/`event.edit`(STAFF)/`availability.edit` | ✅ | `permissions.ts` |
| Web: FullCalendar (mês/semana/dia, **arraste-pra-criar**, clique→detalhe), `EventForm`, `EventDetailModal` | ✅ | `features/calendar/CalendarPage.tsx` |
| Mobile: agenda/dia (F36-S07) | ✅ | `MobileAgenda.tsx` |
| Agente IA marca reunião + lembretes cron | ✅ | F7 |

---

## 3. Levantamento — o que FALTA / está fraco (a feature)

### L1 — Visibilidade NÃO é aplicada na lista nem nos eventos 🔴 (gap de privacidade)
- `GET /api/calendars` retorna **todos** os calendários do workspace (sem filtrar por `canAccessCalendar`). `GET /api/events` sem filtro retorna **todos os eventos do workspace** (RLS escopa só por workspace, não por calendário). → Um membro comum, selecionando "Todos", **vê eventos do calendário pessoal de colegas**. É o oposto de "cada um vê o seu". **Vazamento real** — alinhado ao foco da auditoria de segurança recente.
- **Fix:** filtrar a lista e a query de eventos por `canAccessCalendar` (lista só os calendários que o membro pode ver; eventos só dos calendários visíveis). Suportar `calendarIds[]` (overlay).

### L2 — Sem provisionamento de calendário pessoal 🔴
- Não há criação automática de calendário pessoal por membro nem de um "Empresa" default (só o seed-demo cria 1 `workspace`). Logo, "cada um vê o seu" não se realiza, e `calendar.manage` (criar calendário) é MANAGERS — um AGENT comum não teria onde marcar.
- **Fix:** provisionar **1 calendário pessoal por membro** (auto, no primeiro acesso/criação de membro) + **1 calendário "Empresa"** (workspace) default. Evento novo cai no calendário pessoal por padrão.

### L3 — Sem UX multi-calendário (overlay) 🟠
- Hoje é **um dropdown** "Todos / [calendário]" — um por vez. Falta a **trilha lateral** estilo Google Calendar: grupos **Meu calendário · Empresa · Times · (para o owner) Pessoas**, cada um com **cor + checkbox liga/desliga**, sobrepondo vários ao mesmo tempo.

### L4 — Cor por TIPO, não por calendário 🟠
- Para overlay multi-calendário, o padrão é **colorir por calendário** (cada `calendars.color`) + legenda. Hoje colore por tipo de evento.

### L5 — Agendamento raso 🟠
- Arraste-pra-criar existe, mas **não há arrastar-pra-mover / redimensionar** evento (FullCalendar `editable`/`eventDrop`/`eventResize` não ligados), nem **eventos recorrentes** ("marcar diferentes horários" — ver D1). `EventForm` é básico. Visão default é mês (semana/dia "marcam horários" melhor).

### L6 — Acesso a team desatualizado 🟡
- `canAccessCalendar` para `team` restringe a "managers" porque `teams` não existia. **Agora existe** (F8: `teams` + `team_members`) → calendário de time deveria ser visível aos **membros do time** (e supervisor vê os times que lidera).

### L7 — Polish/personalização 🟡
- Falta mini-mês navegador, default semana, destaque "hoje", popover de evento ao hover, empty/help states (§2.5/§2.6), atalhos, densidade — o que o founder chama de "mais trabalhado e interativo".

---

## 4. Design proposto (UX-forward, DS v2)

- **Trilha de calendários (sidebar esquerda):** grupos **Meu calendário** (pessoal) · **Empresa** (workspace) · **Times** (calendários de time do membro) · **Pessoas** (para OWNER/ADMIN: o pessoal de cada membro). Cada item = ponto de cor + nome + **checkbox de visibilidade**. Overlay de vários ao mesmo tempo; estado persistido por membro.
- **Eventos coloridos por calendário** (+ leve indicador de tipo) + **legenda**. Cor vem de `calendars.color` (DS tokens / paleta curada).
- **Agendamento rico:** default **semana (timeGrid)** pra "marcar diferentes horários"; **arraste-pra-criar + arraste-pra-mover + redimensionar** (com permissão + ownership); `EventForm` 2.0 (calendário, tipo, participantes, local/URL, contato/deal, recorrência se D1=sim); **popover** de evento.
- **Visibilidade ponta a ponta:** lista + eventos escopados por `canAccessCalendar`/role/ownership. Owner/Admin veem todos os pessoais; supervisor vê os times que lidera; cada um vê o seu + Empresa.
- **Personalização/interatividade:** mini-mês navegador, switcher de visão (mês/semana/dia/agenda), "Hoje", `?` HelpPanel contextual, empty states que convidam, atalhos de teclado, densidade.
- **Mobile:** estende a agenda (F36-S07) com a trilha de calendários como **sheet** + cor por calendário (reconciliar).

---

## 5. Decomposição proposta — Fase **F37 (Calendar 2.0)**

- **S01 [db+api] — Visibilidade + provisionamento (fundação 🔴):** filtrar `GET /api/calendars` por `canAccessCalendar`; escopar `GET /api/events` por calendários visíveis + suportar `calendarIds[]`; provisionar calendário pessoal por membro + "Empresa" default; atualizar acesso de `team` para `team_members` (F8) + supervisor→times liderados. Testes (inclui regressão do vazamento L1).
- **S02 [api] — Agendamento rico no backend:** garantir mover/redimensionar (PUT start/end já existe — validar ownership/permite arrastar), participantes no detalhe, e **recorrência** (se D1=sim: RRULE simples + expansão na query).
- **S03 [web] — Trilha de calendários + overlay + cor-por-calendário + legenda** (desktop). dep: S01.
- **S04 [web] — Agendamento rico:** default semana, arraste mover/resize, `EventForm` 2.0 (calendário/participantes/tipo/recorrência), popover de evento. dep: S01, S02.
- **S05 [web] — Personalização/polish:** mini-mês, switcher de visão, "Hoje", empty/help states, atalhos, densidade. dep: S03.
- **S06 [web] — Mobile:** trilha como sheet + cor-por-calendário na agenda (reconcilia F36-S07). dep: S01, S03.
- **S07 [qa] — Testes + audit (regressão do vazamento) + docs** (`CALENDAR.md` v2). dep: todos.

**Grafo:** S01 → {S02, S03} ; S03 → {S05, S06} ; {S01,S02} → S04 ; tudo → S07.

---

## 6. Decisões a confirmar
- **D1 — "Marcar diferentes horários" = recorrência?** Incluir **eventos recorrentes** (diário/semanal/até-data) agora *(recomendado se "diferentes horários" inclui repetição)* — é um add significativo (RRULE + expansão) → vira S02/S04. **OU** significa só agendar bem em horários variados na grade semana/dia (sem repetição) → defere recorrência. **Preciso do seu esclarecimento aqui.**
- **D2 — Estrutura dos calendários:** 1 pessoal por membro (auto) + 1 "Empresa" (workspace) + calendários de time opcionais *(recomendado)*.
- **D3 — Quem cria evento e onde:** AGENT cria no **seu pessoal** (e na Empresa, se permitido); `event.edit`=STAFF mantém *(recomendado)*.
- **D4 — Supervisor:** vê os calendários dos **times que lidera** (via `team_members` F8) *(recomendado)*.

> **Nota:** F36 (mobile) está em 7/14 — pausada para este pedido. A F37 deve reconciliar com F36-S07 (calendário mobile). Recomendo terminar/segurar conforme você priorizar.
