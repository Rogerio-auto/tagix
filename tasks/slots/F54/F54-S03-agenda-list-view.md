---
id: F54-S03
title: Agenda Central — visão lista por dia + grade/mobile/detalhe enriquecidos
phase: F54
status: blocked
priority: high
estimated_size: L
depends_on: [F54-S01]
blocks: [F54-S05]
agent_id: frontend-engineer
source_docs:
  - docs/features/AGENDA_SYNC.md
  - docs/UX_PRINCIPLES.md
  - docs/MOBILE_UX.md
ux_considerations:
  - "Aprovado pelo founder: nova VISÃO EM LISTA agrupada por dia (não substitui a grade)."
  - "Aplica 3.9 — agrupar por dia; vencidos e HOJE em destaque; ordenar por horário."
  - "Aplica 2.1 — clique no corpo do item abre detalhe; ações rápidas óbvias (não ícones obscuros)."
  - "Aplica 2.3 — detalhe/ações em drawer/sheet; reagendar em modal leve."
  - "Cartão do cliente: foto (Avatar @hm/ui), nome, telefone, tipo (ícone), prioridade+status (badges)."
---

# F54-S03 — Agenda Central: visão lista por dia + enriquecimento

## Objetivo

Tornar a Agenda Central uma extensão viva do Cockpit: uma visão de follow-ups em **lista agrupada por
dia**, com cartão do cliente e ações rápidas — e mostrar o cliente também na grade e na agenda mobile.

## Contexto

`features/calendar` tem `CalendarPage` (FullCalendar mês/semana/dia), `EventDetailModal`, `MobileAgenda`,
`queries.ts` (`useEvents`/`useCalendars`/`useUpdateEvent`/`useCancelEvent`). O S01 passa a devolver
`contact: { id, name, avatarUrl, phone } | null` por evento. O `Avatar` de `@hm/ui` (F48) faz foto+
fallback de iniciais. `QuickScheduleModal`/`AppointmentDetail` existem em `features/cockpit-agenda` (F53)
e podem ser reusados.

## Escopo

### files_allowed
- `apps/web/features/calendar/**` (nova visão lista + toggle na CalendarPage + EventDetailModal +
  MobileAgenda + tipo `contact` em types.ts/queries.ts)

### files_forbidden
- `apps/web/features/cockpit-agenda/**` (reusar via import read-only), `apps/web/shared/realtime/**`
  (dono: S02), `apps/api/**`, `packages/**`

## Escopo (faz)
- **Visão lista** (nova): toggle "Lista" ao lado de Mês/Semana/Dia na `CalendarPage`. Agrupa por dia
  (cabeçalho `HOJE · qui 28 jun`, `AMANHÃ`, datas), ordena por horário. **Vencidos** (passado e status
  não-terminal) e **HOJE** com destaque visual (tokens DS v2, sem hex). Cada item = cartão do cliente:
  `Avatar` (foto/iniciais), nome, telefone, data·horário, ícone do tipo, badge de prioridade e status,
  descrição.
- **Ações rápidas** por item: Abrir conversa (`conversationId`→`/conversations/:id`), Abrir cockpit
  (abre a conversa com o painel direito), Editar, Reagendar, Concluir (`PUT` status `completed`),
  Cancelar (`POST /:id/cancel`). Reusar `AppointmentDetail`/`QuickScheduleModal` de `cockpit-agenda`
  quando couber; gate por permissão (`event.edit`).
- **Grade + mobile:** mostrar o cliente (nome/foto) no render do evento (FullCalendar `eventContent`) e
  as ações no `EventDetailModal`; `MobileAgenda` idem. Consome `contact` do S01.
- Tipos: estender `EventRow` (em `types.ts`) com `contact` opcional. Sem `any`.

## Fora de escopo
- Tempo real/ouvinte (S02 — a lista atualiza sozinha quando S02 estiver no ar). Backend (S01). Worker (S04).

## Permission scope
`calendar.view` (ver) / `event.edit` (criar/transicionar/cancelar — botões gated). Visibilidade de
calendário já vigente — não mostrar evento de calendário fora do acesso.

## Definition of Done
- [ ] Toggle "Lista" funcional: agrupada por dia, ordenada por horário, vencidos+hoje destacados.
- [ ] Cartão com foto/nome/telefone/tipo/prioridade/status/descrição; "Abrir conversa" e "Abrir cockpit".
- [ ] Editar/Reagendar/Concluir/Cancelar funcionam e refletem na lista; grade e mobile mostram o cliente.
- [ ] Mobile: lista usável (sheet/alvos ≥44px); sem hex hardcoded; animações <250ms motion-safe.
- [ ] `pnpm typecheck`, `pnpm lint` verdes; teste do slot passa.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas
e2e não roda neste host — validar por typecheck/lint/unit. Reusar `Avatar` (@hm/ui),
`QuickScheduleModal`/`AppointmentDetail` (cockpit-agenda, import read-only). O `useEvents` já suporta
janela [from,to] e contactId; a lista usa uma janela ampla (ex.: -7d a +60d) escopada aos calendários
selecionados.
