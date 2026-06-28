---
id: F53-S08
title: Extrair criação de evento para @hm/db (eventRepo.create) + event-service vira wrapper
phase: F53
status: available
priority: high
estimated_size: S
depends_on: [F53-S02]
blocks: [F53-S07]
agent_id: db-engineer
source_docs:
  - docs/features/COCKPIT_AGENDA.md
  - docs/features/CALENDAR.md
---

# F53-S08 — Extrair criação de evento para @hm/db (eventRepo.create)

## Objetivo

Mover o **núcleo de persistência** da criação de evento de `apps/api/src/services/event-service.ts`
para o pacote de dados compartilhado `@hm/db`, de modo que **API e worker usem exatamente o mesmo
código** de criação — fonte única da verdade, zero duplicação. O `event-service` da API passa a ser um
wrapper fino: chama o repo + dispara o seam `onEventChanged` (que permanece client-side da API).

## Contexto

Decisão de arquitetura travada (founder, 2026-06-28): a automação (S07) precisa criar compromisso, mas
`@hm/workers` **não depende de `@hm/api`** por desenho. O ponto único de criação hoje vive só no
`event-service` da API (`createEvent(tx, input, actor)`: resolução de calendar + insert `events` +
insert `eventParticipants` organizer/contact + seam `onEventChanged('created')`). `@hm/db` já hospeda
`calendarRepo` (ensure*/accessibleCalendarIds) mas **não** expõe criação de evento. Este slot fecha essa
lacuna sem violar a fronteira de pacotes (ambos dependem de `@hm/db`, o que é legítimo).

## Escopo

### files_allowed

- `packages/db/src/repos/calendar.ts` (adicionar `createEvent` ao `calendarRepo`, ou novo `eventRepo`)
- `packages/db/src/index.ts` (apenas se precisar exportar o novo símbolo no barrel)
- `apps/api/src/services/event-service.ts` (refatorar para wrapper fino sobre o repo)
- `packages/db/src/repos/__tests__/**` (teste do repo, se aplicável)
- `apps/api/src/routes/calendar/__tests__/**` (atualizar o mock de `@hm/db` para acompanhar a nova arquitetura — o mock precisa expor `calendarRepo.createEvent` + `CalendarNotFoundError`)

### files_forbidden

- `apps/workers/**` (S07 consome o repo), `apps/web/**`, qualquer outro schema em `packages/db/src/schema/*`

## Escopo (faz)

- Extrair a persistência pura de criação para `@hm/db`: resolução de calendar (reusar
  `ensureWorkspaceCalendar`/`accessibleCalendarIds` já presentes) + `insert(events)` (incluindo
  `priority`/novos `type` da F53-S02) + `insert(eventParticipants)` (organizer + contact attendee).
  Assinatura sugerida: `calendarRepo.createEvent(tx, input)` retornando o `event` criado.
- `event-service.createEvent(tx, input, actor)` passa a: chamar `calendarRepo.createEvent` + disparar o
  seam `onEventChanged('created', ...)` (o seam **fica na API**, não vai pro repo).
- **Comportamento idêntico** para a API: mesma assinatura pública, mesmos participantes, mesmo retorno,
  mesma visibilidade (`accessibleCalendarIds` intacta), mesma RLS (`withWorkspace`).

## Fora de escopo

- Wiring no worker (S07). Qualquer UI. Mudança de schema (S01 já fez).

## Contratos de entrada/saída

- `calendarRepo.createEvent(tx, input)` exportado de `@hm/db`, reusável por API e worker.
- `event-service.createEvent` mantém assinatura/efeitos atuais (só delega o insert).

## Definition of Done

- [ ] Núcleo de criação vive em `@hm/db`; `event-service` é wrapper fino + seam.
- [ ] Testes existentes de calendar (`routes.test.ts`, validation de S02) seguem verdes — sem regressão.
- [ ] `priority`/novos `type` preservados no insert; participantes idênticos.
- [ ] `pnpm typecheck` e `pnpm lint` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

Não duplicar o insert: depois deste slot há UM lugar de persistência (`@hm/db`). O seam `onEventChanged`
é registrado no bootstrap da API — no worker (S07) simplesmente não terá hooks, e os lembretes do
`calendar-reminders` (S05) pegam o evento por polling da tabela, então isso é aceitável.
