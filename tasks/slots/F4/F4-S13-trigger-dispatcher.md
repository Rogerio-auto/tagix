---
id: F4-S13
title: Trigger dispatcher (inbound) — keyword/new_message/new_lead/system_event + resume waiting flows
phase: F4
status: in-progress
priority: high
estimated_size: M
depends_on: [F4-S01, F4-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:38:21Z

---
# F4-S13 — Trigger dispatcher (inbound)

> **source_docs:** `docs/features/FLOW_BUILDER.md` §5, §4.2; `docs/ROADMAP.md` F4-S17
> **blocks:** —

## Objetivo
Conectar eventos inbound à engine: (1) `dispatchTriggersForNewMessage` — avalia flows `active` com trigger `keyword`/`new_message`/`new_lead`/`system_event` e dispara `triggerFlow({ triggeredBy: 'automatic' })`; (2) **resume** — quando chega mensagem numa conversa com execução `waiting_for_response`, chama `resumeFlowWithResponse`. Triggers `stage_change`/`tag_added` ficam **deferidos para F5** (deals/contact_tags não existem ainda) — declarados como no-op com log.

## Escopo (faz)
- `apps/workers/src/flows-triggers/**`: `evaluateTrigger`, `dispatchTriggersForNewMessage`, hook de resume; consulta `flows` (RLS) e usa a API pública de `@hm/flow-engine`.
- O ponto de chamada no pipeline inbound (após persistir a mensagem) é um gap-fill de 1-2 linhas do orchestrator (padrão F3), mantendo o worker-inbound F1 intocado fora do hook.

## Fora de escopo
- Engine (F4-S02), worker-flows runtime (F4-S03), stage_change/tag_added reais (F5), meta flow_submission (F4-S14).

## Arquivos permitidos
- `apps/workers/src/flows-triggers/**`

## Definition of Done
- [ ] Nova mensagem inbound avalia triggers e dispara os flows que casam (keyword case-insensitive, message_types filter); teste cobre match e no-match.
- [ ] Mensagem numa conversa com `waiting_for_response` retoma a execução (edge `response`); sem execução waiting, no-op.
- [ ] `stage_change`/`tag_added` logam "deferido até F5" sem quebrar.
- [ ] `pnpm --filter @hm/workers test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Só inbound dispara triggers (§5.1) — worker-outbound não. O resume e o dispatch convivem no mesmo hook inbound.
