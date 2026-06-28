---
id: F53-S03
title: Modal de agendamento rápido + atalhos de data
phase: F53
status: available
priority: high
estimated_size: M
depends_on: [F53-S02]
blocks: [F53-S04]
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_AGENDA.md
  - docs/UX_PRINCIPLES.md
  - docs/MOBILE_UX.md
ux_considerations:
  - "Aplica 2.3 — criação curta em modal leve (exceção aceita), não full-screen; mobile vira sheet."
  - "Aplica 2.7 — feedback imediato no submit (botão loading/disabled) + toast de sucesso/erro."
  - "Aplica 2.11 — erro em 3 partes (o quê/porquê/o que fazer) vindo do 422 da API."
  - "Aplica 3.5 — atalhos de data com hover/cursor claros; ação primária óbvia."
---

# F53-S03 — Modal de agendamento rápido + atalhos de data

## Objetivo

Modal leve para o operador criar um compromisso em segundos a partir do Cockpit: Data, Hora, Tipo,
Descrição, Prioridade — com **atalhos de data de 1 clique**. Componente autocontido, reusável pela card
da Agenda (S04).

## Contexto

Existe `EventForm` no calendário (`features/calendar`), mas é pesado e fora do contexto da conversa. O
Cockpit precisa de um modal enxuto, pré-preenchido com o contato/conversa atual. Desbloqueia o card (S04),
que importa este modal.

## Escopo

### files_allowed

- `apps/web/features/cockpit-agenda/QuickScheduleModal.tsx`
- `apps/web/features/cockpit-agenda/quickDates.ts`
- `apps/web/features/cockpit-agenda/quickDates.test.ts`
- `apps/web/features/cockpit-agenda/types.ts`
- `apps/web/features/cockpit-agenda/index.ts`

### files_forbidden

- `apps/web/features/conversations/**` (S04 é dono do mount), `apps/web/features/calendar/**`

## Escopo (faz)

- `quickDates.ts` (lógica **pura**, testável): resolve atalhos → `{ startAt, endAt }` ISO com offset:
  `Hoje 17h`, `Amanhã` (09h default), `Daqui 3 dias`, `Próxima semana`, `Próximo mês`, `Personalizar`.
  Usar a lib de data já presente no web (date-fns). Teste cobre cada atalho + borda de virada de dia/mês.
- `QuickScheduleModal.tsx`: campos Data, Hora, Tipo (7 opções: follow-up, ligação, whatsapp, reunião,
  cobrança, envio de proposta, personalizado → mapeados aos `type` do schema), Descrição, Prioridade
  (baixa/média/alta). Atalhos como chips acima dos pickers.
- Recebe props `contactId`, `conversationId`, `open`, `onClose`, `onCreated`. POST via `useCreateEvent`
  (hook de `features/calendar/queries.ts`, importado read-only) com `priority`/`type`.
- Empty/erro/loading do submit; mobile usa `@/shared/components/Sheet` (bottom-sheet) abaixo de `md`.

## Fora de escopo

- A card da Agenda e a montagem no `ContactInfoPanel` (S04).
- Histórico (S04). `dueAction` avançado (configuração via UI fica para follow-up; modal só cria simples).

## Contratos de entrada/saída

- Props: `{ open: boolean; contactId: string; conversationId: string; onClose(): void; onCreated?(): void }`.
- Exporta `QuickScheduleModal` e `resolveQuickDate(shortcut)` via `index.ts` para o S04.

## Definition of Done

- [ ] `quickDates.ts` puro + teste unit verde cobrindo os 6 atalhos e bordas.
- [ ] Modal cria evento com `type`+`priority` corretos; feedback imediato + toast.
- [ ] Erro 422 da API renderizado em 3 partes.
- [ ] Mobile: sheet abaixo de `md` (`useBreakpoint().isMobile`); alvos ≥ 44px; sem hex hardcoded (DS v2).
- [ ] `pnpm typecheck`, `pnpm lint` verdes; teste do slot passa.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

`useCreateEvent` já existe em `features/calendar/queries.ts` — importar, não duplicar. Não criar tela de
calendário aqui. e2e não roda verde neste host (memória `e2e-no-hydration-this-host`) — validar por
typecheck/lint/unit.
