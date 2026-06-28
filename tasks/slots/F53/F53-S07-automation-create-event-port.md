---
id: F53-S07
title: Fechar port create_event da automação
phase: F53
status: available
priority: medium
estimated_size: S
depends_on: [F53-S01, F53-S08]
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/COCKPIT_AGENDA.md
  - docs/features/CALENDAR.md
---

# F53-S07 — Fechar port create_event da automação

## Objetivo

Implementar o port `create_event` das automações (hoje stub que lança `MissingPortError`), permitindo
que regras de automação/flow **criem compromissos no calendário** — o lado "automações baseadas em datas"
da Agenda Inteligente.

## Contexto

`apps/workers/src/automations/executors.ts` já roteia `case 'create_event'` para `ports.createEvent`,
mas o port não é provido (lança `MissingPortError` → retry/failed). O `event-service` é o ponto único de
criação. Este slot conecta os dois, reusando a infra existente.

## Escopo

### files_allowed

- `apps/workers/src/automations/**` (port `createEvent` + wiring no bootstrap de automations)
- `apps/workers/src/automations/__tests__/**`

### files_forbidden

- `apps/workers/src/calendar-reminders/**` (S05), `apps/api/**`, `packages/db/**`, `apps/web/**`

## Escopo (faz)

- Implementar `createEvent(ctx, config)`: cria um `event` (via repo/serviço reusado) com
  `workspaceId`/`contactId`/`conversationId` do contexto da automação, `type`/`priority` do config,
  `startAt`/`endAt` resolvidos de offset relativo (ex.: "daqui 2 dias") ou data fixa do config.
- Wirear o port no bootstrap de automations (junto dos demais: trigger_flow, add_tag, etc.).
- RLS-scope correto no contexto do worker (GUC `app.workspace_id` preenchido — ver F40-S01).
- Idempotência: respeitar o padrão de `pending_automations` (SELECT FOR UPDATE SKIP LOCKED já existente).

## Fora de escopo

- Lembrete/socket/dispatch ao vencer (S05). UI (S04/S06). Schema (S01).

## Contratos de entrada/saída

- `config` de `create_event` (jsonb da regra): `{ kind: 'create_event', title, type?, priority?, offset?|startAt?, durationMinutes? }`.
- Cria linha em `events` consistente com o contrato de S01/S02.

## Definition of Done

- [ ] Port `create_event` implementado e wired; `case 'create_event'` não lança mais `MissingPortError`.
- [ ] Evento criado com workspace/contact corretos e RLS-scope válido.
- [ ] Teste unit do executor cobrindo criação + offset relativo.
- [ ] `pnpm typecheck`, `pnpm lint` verdes; testes do slot passam.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

Reusar o caminho de criação do `event-service` (não duplicar insert). GUC vazio quebra schedulers
(F40-S01) — garantir scope. Paralelo a S05 (arquivos disjuntos: automations vs calendar-reminders).
