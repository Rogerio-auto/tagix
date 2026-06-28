---
id: F53-S04
title: Card Agenda + Histórico no Cockpit
phase: F53
status: done
priority: high
estimated_size: M
depends_on: [F53-S03]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_AGENDA.md
  - docs/UX_PRINCIPLES.md
  - docs/MOBILE_UX.md
ux_considerations:
  - "Aplica 2.6 — empty state 'Nenhum compromisso agendado' + CTA; estado sem contato orienta vincular."
  - "Aplica 2.7 — skeleton no loading da lista; toast nas ações."
  - "Aplica 2.3 — detalhe do compromisso em drawer/sheet, não modal full-screen."
  - "Aplica 3.9 — histórico como timeline vertical com check + relativo a 'agora'."
  - "Aplica 2.1 — clique no corpo do item abre detalhe; ação primária óbvia (não ícone obscuro)."
completed_at: 2026-06-28T16:41:11Z

---
# F53-S04 — Card Agenda + Histórico no Cockpit

## Objetivo

Adicionar a section **Agenda / Próximos Compromissos** ao `ContactInfoPanel`, integrada às demais
informações do contato: lista de próximos compromissos, histórico em timeline, e atalho "Abrir conversa".
Botão **+ Novo Agendamento** abre o modal rápido (S03).

## Contexto

O Cockpit (`ContactInfoPanel`) já compõe sections (Status, Cliente, Card/Negócio, Conversão, etc.) com
o padrão `Section`/`Card`. `useEvents({ contactId, from, to })` já existe. Esta é a peça central que
transforma o Cockpit em centro de gestão comercial.

## Escopo

### files_allowed

- `apps/web/features/cockpit-agenda/AgendaSection.tsx`
- `apps/web/features/cockpit-agenda/AppointmentDetail.tsx`
- `apps/web/features/cockpit-agenda/AgendaSection.test.tsx`
- `apps/web/features/conversations/components/ContactInfoPanel.tsx`

### files_forbidden

- `apps/web/features/cockpit-agenda/QuickScheduleModal.tsx` / `quickDates.ts` / `index.ts` / `types.ts` (donos: S03)
- `apps/web/features/calendar/**`

## Escopo (faz)

- `AgendaSection.tsx`: usa `useEvents({ contactId, from: now, to: now+90d })`. Lista **próximos**
  (`status` não-terminal) ordenados por `startAt`, formato `Amanhã • 09:00 • Retornar ligação`. Ícone por
  `type`, badge por `priority` e `status` (identidade visual por estado — tokens DS v2, sem hex).
- **Histórico**: compromissos `completed`/`cancelled` em timeline vertical (UX §3.9) com check + data.
- Estados: empty (`Nenhum compromisso agendado` + CTA "Novo Agendamento"), loading (skeleton), error (3
  partes), sem-contato (orienta vincular).
- **+ Novo Agendamento** → abre `QuickScheduleModal` (S03), pré-preenchido com `contactId`/`conversationId`.
- Clicar no item → `AppointmentDetail` (drawer/sheet) com ações: marcar `in_progress`/`completed`,
  adiar (`postponed`, repõe data via modal), cancelar; e **"Abrir conversa"** → `event.conversationId`.
- Montar a section no `ContactInfoPanel` (uma única edição), na ordem de hierarquia adequada (topo do
  bloco de contexto comercial). Invalidar queries ao mutar.

## Fora de escopo

- O modal em si (S03). Notificações/som (S05/S06). Disparo de `dueAction` (S05/S07).

## Contratos de entrada/saída

- `AgendaSection` props: `{ contactId: string | null; conversationId: string }`.
- Consome `QuickScheduleModal` e tipos de `features/cockpit-agenda/index.ts` (S03).

## Permission scope

`calendar.view` para ver; `event.edit` para criar/transicionar (botões gated). Ver `PERMISSIONS.md §2.x`.

## Definition of Done

- [ ] Section montada no `ContactInfoPanel` com próximos + histórico + estados explícitos.
- [ ] "+ Novo Agendamento" abre o modal e a lista atualiza após criar.
- [ ] Detalhe em drawer/sheet com "Abrir conversa" e transições de status.
- [ ] Mobile: sheet abaixo de `md`; alvos ≥ 44px; sem hex hardcoded; animações < 250ms `motion-safe`.
- [ ] `pnpm typecheck`, `pnpm lint` verdes; teste do slot passa.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

`ContactInfoPanel.tsx` é arquivo compartilhado — esta é a **única** edição dele na F53; manter o diff
cirúrgico (mount da section). `useEvents` já suporta `contactId`. e2e não valida neste host — usar
typecheck/lint/unit.
