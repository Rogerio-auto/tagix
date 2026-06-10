---
id: F2-S15
title: Seed — catálogo inicial llm_models_whitelist (top modelos OpenRouter)
phase: F2
status: review
priority: medium
estimated_size: XS
depends_on: [F2-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:19:30Z
completed_at: 2026-06-10T03:19:30Z

---
# F2-S15 — Seed de llm_models_whitelist

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §5.2; `docs/ROADMAP.md` F2-S15
> **blocks:** F2-S17

## Objetivo
Popular o catálogo inicial de `llm_models_whitelist` com ~15 modelos OpenRouter de uso real (id, label, custo input/output por 1M tokens, capabilities, ativo), base para policies e o model picker.

## Escopo (faz)
- `packages/db/src/seed/llm_models.ts`: `seedLlmModels(db)` idempotente (upsert por model id) com os ~15 modelos + metadados de custo/capacidade. Wiring em `seed.ts` = orchestrator.

## Fora de escopo
- Sync ao vivo com OpenRouter `/models` (F2.5-S02), schema (F2-S01).

## Arquivos permitidos
- `packages/db/src/seed/llm_models.ts`

## Definition of Done
- [ ] ~15 modelos inseridos idempotentemente com custos/capacidades coerentes.
- [ ] `default_model` do seed de templates (`openai/gpt-4o-mini`) presente na whitelist.
- [ ] `pnpm --filter @hm/db typecheck`/lint verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
Custos devem refletir o pricing OpenRouter no momento do seed; F2.5-S02 mantém atualizado depois.
