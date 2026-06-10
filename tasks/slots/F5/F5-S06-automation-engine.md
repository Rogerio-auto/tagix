---
id: F5-S06
title: Automation engine — pending_automations worker + on_stale cron + dispatch from move
phase: F5
status: blocked
priority: high
estimated_size: M
depends_on: [F5-S02, F5-S05]
---
# F5-S06 — Automation engine

> **source_docs:** `docs/features/PIPELINE.md` §3.2, §3.3, §3.4; `docs/ROADMAP.md` F5-S07
> **blocks:** F5-S14

## Objetivo
Motor de automações por stage: ao mudar stage, despacha `automation_rules` (`on_exit` do antigo + `on_enter` do novo) persistindo em `pending_automations` (sobrevive a crash); um worker drena `pending_automations` vencidas com retry/backoff; um cron diário avalia `on_stale` (deals parados > N dias).

## Escopo (faz)
- `apps/workers/src/automations/**`: `processPendingAutomations` (drena due, executa action, retry 3× → failed), executor por `action` (`trigger_flow`/`send_message`/`notify_members`/`create_event`/`add_tag`/`remove_tag`/`register_conversion`), e o cron `on_stale` (§3.4).
- Wiring do `onStageChanged` (seam de F5-S05) → `dispatchAutomationRules` que agenda em `pending_automations` (gap-fill do orchestrator no `deal-move.ts` se preciso, 1-2 linhas).
- Registro no bootstrap (gap-fill orchestrator, padrão F3).

## Fora de escopo
- Schema `pending_automations` (F5-S02), socket (F5-S07), handler `register_conversion`/`add_tag` reais (F5-S14/S16 — aqui só roteia para eles).

## Arquivos permitidos
- `apps/workers/src/automations/**`

## Definition of Done
- [ ] Mudança de stage agenda automações em `pending_automations`; worker executa as vencidas e aplica retry/backoff (→ failed após 3×).
- [ ] Cron `on_stale` enfileira automações de deals parados > N dias; guard anti-loop (limite de auto-moves/deal/dia, §14).
- [ ] `pnpm --filter @hm/workers test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- `action: 'trigger_flow'` chama a API pública do `@hm/flow-engine` (já existe da F4). `register_conversion`/`add_tag` delegam ao que F5-S14/S16 implementam.
