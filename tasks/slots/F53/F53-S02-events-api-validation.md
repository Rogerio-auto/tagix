---
id: F53-S02
title: API/tool aceitam priority, novos type e transições de status
phase: F53
status: done
priority: high
estimated_size: S
depends_on: [F53-S01]
blocks: [F53-S03]
agent_id: backend-engineer
source_docs:
  - docs/features/COCKPIT_AGENDA.md
  - docs/features/CALENDAR.md
completed_at: 2026-06-28T15:33:46Z

---
# F53-S02 — API/tool aceitam priority, novos type e transições de status

## Objetivo

Estender a camada de validação de `/api/events` (e a tool `schedule_event`) para aceitar `priority`,
os novos `type`, o `metadata.dueAction`, e impor uma máquina de transição de `status` server-side.

## Contexto

As rotas `POST/PUT /api/events` e `POST /api/events/:id/cancel` já existem (Calendar 2.0), assim como o
filtro `GET /api/events?contact=`. Só falta aceitar/validar os campos novos da F53 e governar as
transições de estado (`in_progress`/`postponed`/`completed`). Desbloqueia o modal rápido (S03).

## Escopo

### files_allowed

- `apps/api/src/routes/calendar/events.ts`
- `apps/api/src/internal/tools/calendar-handlers.ts`
- `apps/api/src/services/event-service.ts`
- `apps/api/src/routes/calendar/__tests__/**` (testes do slot)

### files_forbidden

- `packages/db/**` (schema é de S01), `apps/web/**`

## Escopo (faz)

- Zod de `POST /api/events`: aceitar `priority` (`low|medium|high`, default `medium`), `type` ampliado
  (`call|whatsapp|billing|proposal|custom` além dos atuais), `metadata.dueAction` opcional
  (`{ kind: 'trigger_flow'|'send_message'|'move_stage'|'add_tag'|'notify_members', ...payload }`).
- Zod de `PUT /api/events/:id`: aceitar `priority`, `dueAction` e mudança de `status`.
- Máquina de transição de status (server-side): `cancelled`/`completed` são terminais; `postponed`
  exige `startAt` futuro no payload; transições inválidas → **422** com mensagem PT-BR (UX §2.11).
- `schedule_event` (tool de agente) aceita `priority`/novos `type` no mesmo contrato.

## Fora de escopo

- Disparo do `dueAction` quando o evento vence (S05/S07) — aqui só persiste/valida.
- Qualquer UI (S03/S04).

## Contratos de entrada/saída

- `POST /api/events` retorna `{ event }` com `priority` e `type` novos persistidos.
- `PUT /api/events/:id` aplica transição válida ou retorna 422 `{ error, message }`.
- Contrato consumido pelo S03 (modal): `{ title, startAt, endAt, type, priority, description?, contactId, conversationId, metadata?.dueAction? }`.

## Permission scope

`event.edit` (STAFF) para criar/editar/transicionar; `calendar.view` (ALL) para ler. Ownership fino já
vigente (criador/admin). Ver `PERMISSIONS.md §2.x` — **sem permissão nova**.

## Definition of Done

- [ ] Zod aceita `priority`/novos `type`/`dueAction` em POST e PUT.
- [ ] Transições inválidas retornam 422 com 3 partes (o quê/porquê/o que fazer).
- [ ] Tool `schedule_event` aceita os campos novos.
- [ ] Testes de integração cobrindo: criar com priority+type novo, transição válida, transição inválida (422).
- [ ] `pnpm typecheck` e `pnpm lint` verdes; testes do slot passam.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

Reusar `event-service.ts` (ponto único de criação/cancelamento + seam `onEventChanged`). Não regredir o
fechamento de visibilidade do `GET /api/events/:id` (intersecção com `accessibleCalendarIds`).
