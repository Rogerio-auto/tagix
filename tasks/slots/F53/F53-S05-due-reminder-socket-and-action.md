---
id: F53-S05
title: Lembrete "na hora" + evento socket + due→ação
phase: F53
status: done
priority: high
estimated_size: M
depends_on: [F53-S01]
blocks: [F53-S06]
agent_id: backend-engineer
source_docs:
  - docs/features/COCKPIT_AGENDA.md
  - docs/features/CALENDAR.md
completed_at: 2026-06-28T15:33:51Z

---
# F53-S05 — Lembrete "na hora" + evento socket + due→ação

## Objetivo

Quando um compromisso vence, notificar o operador **em tempo real** (socket) e, se o evento tiver
`metadata.dueAction`, disparar a ação automaticamente. Estende o worker `calendar-reminders` reusando o
socket relay e os ports existentes — sem novo scheduler.

## Contexto

`calendar-reminders` já roda (tick 5min, offsets 1d + 1h) mas `notifyOrganizer` é só `auditLog` — não
chega ao operador. O socket relay (`hm.q.socket.relay`) e os ports de flow/outbound já existem. Este slot
cria o canal in-app que o frontend (S06) consome.

## Escopo

### files_allowed

- `apps/workers/src/calendar-reminders/**`
- `packages/shared/src/socket-events.ts`
- `apps/workers/src/calendar-reminders/__tests__/**`

### files_forbidden

- `apps/web/**`, `apps/api/src/socket/**` (consumir o relay existente, não reescrever), `packages/db/**`

## Escopo (faz)

- Adicionar offset `0` (vencimento) à lista de offsets do `calendar-reminders` (configurável via env,
  default passa a incluir `0`). Idempotente via `events.metadata.remindersSent` (padrão já existente).
- Novo evento socket em `packages/shared/src/socket-events.ts` (ex.: `appointment:due`) com payload
  `{ eventId, contactId, conversationId, title, startAt, type, priority }`; adicionar ao array runtime
  `SERVER_TO_CLIENT_EVENTS`.
- `notifyOrganizer` passa a **publicar no socket relay** alvo `member:<organizerId>` + `ws:<workspaceId>`
  (em vez de só auditLog), com o payload acima.
- Se `event.metadata.dueAction` presente no vencimento: enfileirar a ação reusando os ports existentes
  (`flowQueuePort.triggerFlow` para `trigger_flow`; outbound para `send_message`; `move_stage`/`add_tag`).
  Falha de port → retry/auditLog (não silenciar). Idempotente (não disparar 2×).

## Fora de escopo

- UI de notificação/som/central (S06). Schema (S01). Port `create_event` da automação (S07).

## Contratos de entrada/saída

- Evento socket `appointment:due` consumido pelo S06.
- `dueAction` lido de `events.metadata` (gravado por S02).

## Definition of Done

- [ ] Offset `0` dispara no vencimento, idempotente (não duplica via `remindersSent`).
- [ ] `appointment:due` definido em `socket-events.ts` + runtime array; publicado via relay para member/ws.
- [ ] `dueAction` presente → ação enfileirada pelos ports existentes; falha vai a retry/auditLog.
- [ ] Teste unit do tick (due selecionado, emit chamado, idempotência).
- [ ] `pnpm typecheck`, `pnpm lint` verdes; testes do slot passam.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

Seguir o padrão F51 (`FlowEventsPort` → relay) para a emissão. Lock singleton e RLS-scope do tick já
existem — não regredir. GUC `app.workspace_id` vazio quebra schedulers (memória/F40-S01): garantir scope
correto ao publicar.
