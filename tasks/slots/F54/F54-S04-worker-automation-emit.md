---
id: F54-S04
title: Automação create_event emite event:created em tempo real
phase: F54
status: blocked
priority: medium
estimated_size: S
depends_on: [F54-S01]
blocks: [F54-S05]
agent_id: backend-engineer
source_docs:
  - docs/features/AGENDA_SYNC.md
---

# F54-S04 — Automação emite event:created em tempo real

## Objetivo

Quando uma automação cria um compromisso (port `create_event`, F53-S07), avisar o workspace em tempo
real (mesmo `event:created` do S01), para aparecer na Agenda/Cockpit sem refresh.

## Contexto

`apps/workers/src/automations/create-event-port.ts` cria via `@hm/db.calendarRepo.createEvent` —
caminho que NÃO passa pelo seam da API, então não emite o socket do S01. O worker já sabe publicar no
relay (`calendar-reminders` emite `appointment:due` via `hm.q.socket.relay`). Reusar essa mecânica.

## Escopo

### files_allowed
- `apps/workers/src/automations/**`
- `apps/workers/src/automations/__tests__/**`

### files_forbidden
- `apps/workers/src/calendar-reminders/**`, `apps/api/**`, `apps/web/**`, `packages/**`
  (o evento `event:created` já é definido pelo S01 em `@hm/shared`; aqui só publica)

## Escopo (faz)
- Após criar o evento no `create-event-port`, publicar `event:created` no relay
  (`makeEnvelope('socket.relay', workspaceId, { eventId, workspaceId, contactId, conversationId,
  kind: 'created' })`), reusando o canal/helper já usado pelo worker. Best-effort (não derruba a
  automação se o publish falhar — log + segue). Idempotente com o resto do port.

## Fora de escopo
- Definição do evento socket (S01). Hook/UI (S02/S03).

## Definition of Done
- [ ] Criação por automação publica `event:created` no relay (best-effort, logado em falha).
- [ ] Teste unit: port chama o publisher com o payload correto após criar.
- [ ] `pnpm typecheck`, `pnpm lint` verdes; testes do slot passam.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
Reusar a mecânica de relay do worker (ver `calendar-reminders`). O nome `event:created` vem de
`@hm/shared` (S01). GUC `app.workspace_id` já é tratado no port (F40-S01) — não regredir.
