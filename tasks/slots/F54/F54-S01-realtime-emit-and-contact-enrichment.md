---
id: F54-S01
title: Tempo real de compromissos (event:*) + resumo do contato na listagem
phase: F54
status: available
priority: high
estimated_size: M
depends_on: []
blocks: [F54-S02, F54-S03, F54-S04]
agent_id: backend-engineer
source_docs:
  - docs/features/AGENDA_SYNC.md
  - docs/features/CALENDAR.md
---

# F54-S01 — Tempo real de compromissos + resumo do contato

## Objetivo

Quando um compromisso é criado/editado/cancelado/concluído, avisar todo o workspace em tempo real
(socket), e enriquecer a listagem de eventos com um resumo do contato (nome/foto/telefone) — para a
Agenda mostrar **quem** atender. Espelha o padrão já provado dos negócios (`deal-events.ts`).

## Contexto

`deal-events.ts` é o modelo: `emitDeal*` publica em `hm.q.socket.relay` via
`makeEnvelope('socket.relay', workspaceId, ...)`, e `socket/relay.ts` reemite por nome para a room
`ws:{id}` (só precisa o nome estar em `SERVER_TO_CLIENT_EVENTS`). Eventos hoje NÃO têm broadcast —
cada tela só invalida local. `events` já tem `contactId`; a listagem não traz dados do contato.

## Escopo

### files_allowed
- `packages/shared/src/socket-events.ts`
- `apps/api/src/services/event-realtime.ts` (NOVO — espelha `deal-events.ts`)
- `apps/api/src/routes/calendar/events.ts`
- `apps/api/src/routes/calendar/__tests__/**`

### files_forbidden
- `apps/api/src/socket/relay.ts` (genérico — NÃO mexer; reemite pelo nome), `apps/web/**`,
  `apps/workers/**`, `packages/db/**`

## Escopo (faz)
- Em `socket-events.ts`: definir `event:created`, `event:updated`, `event:deleted` (map
  `ServerToClient`) + adicionar ao array runtime `SERVER_TO_CLIENT_EVENTS`. Payload:
  `{ eventId, workspaceId, contactId, conversationId, kind: 'created'|'updated'|'deleted' }`.
- `event-realtime.ts`: `emitEventCreated/emitEventUpdated/emitEventDeleted` publicando no relay
  (copiar a mecânica de `deal-events.ts`; mesma fila/envelope).
- Em `events.ts`: chamar o emit após cada mutação — POST→created, PUT→updated (inclui transições de
  status), `POST /:id/cancel`→updated (kind 'deleted' OU 'updated'; use 'updated' com status
  cancelled). Best-effort: `void emit...(...)`, sem bloquear a resposta nem derrubar em erro.
- **Enriquecimento:** `GET /api/events` e `GET /api/events/:id` incluem por evento
  `contact: { id, name, avatarUrl: string | null, phone: string | null } | null` (join em
  `contacts`; sem vínculo → `null`). Campo ADITIVO — não quebrar o contrato atual. Confirme o nome da
  coluna de foto em `contacts` (avatar/avatar_url/photo) lendo o schema antes.

## Fora de escopo
- Hook/render no web (S02/S03). Emit pelo worker (S04). Schema (events já tem tudo — F53).

## Contratos de saída
- `event:created|updated|deleted` consumido pelo S02.
- `GET /api/events*` retorna `contact` resumido por evento (consumido por S03).

## Permission scope
`event.edit` (mutações) / `calendar.view` (leitura) — sem permissão nova. O broadcast é para `ws:{id}`;
a UI cliente filtra pela visibilidade já vigente.

## Definition of Done
- [ ] `event:*` definidos em socket-events.ts + runtime array; emit best-effort nas 3 mutações.
- [ ] `GET /api/events` e `/:id` retornam `contact` resumido (ou null); sem regressão na visibilidade.
- [ ] Testes de integração: emit chamado nas mutações; payload da listagem inclui `contact`.
- [ ] `pnpm typecheck`, `pnpm lint` verdes; testes do slot passam (testes de calendar existentes não regridem).

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Espelhar `deal-events.ts` (não inventar mecânica nova de relay). `socket/relay.ts` é genérico —
não tocar. Emit é best-effort (a persistência é a fonte da verdade; o socket é só notificação).
