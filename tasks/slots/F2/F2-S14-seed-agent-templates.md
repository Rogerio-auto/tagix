---
id: F2-S14
title: Seed — 5 agent templates globais + questions + default_tools + default_model
phase: F2
status: done
priority: medium
estimated_size: S
depends_on: [F2-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:19:27Z
completed_at: 2026-06-10T03:19:28Z

---
# F2-S14 — Seed de agent templates

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §7; `docs/ROADMAP.md` F2-S14
> **blocks:** F2-S17

## Objetivo
Popular 5 templates globais de agente (`sales`, `reception`, `support`, `first_touch`, `follow_up`) com suas `agent_template_questions`, `default_tools` e `default_model` (`openai/gpt-4o-mini`), prontos para o wizard de criação consumir.

## Escopo (faz)
- `packages/db/src/seed/agent_templates.ts`: `seedAgentTemplates(db)` idempotente (upsert por key) com os 5 templates + perguntas + defaults. Exporta a função para `seed.ts` chamar (wiring = orchestrator).

## Fora de escopo
- Schema (F2-S01), whitelist de modelos (F2-S15), wizard UI (F2-S17).

## Arquivos permitidos
- `packages/db/src/seed/agent_templates.ts`

## Definition of Done
- [ ] 5 templates + questions + default_tools/model inseridos idempotentemente.
- [ ] Re-run do seed não duplica.
- [ ] `pnpm --filter @hm/db typecheck`/lint verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
Templates são globais (sem workspace_id). O orchestrator importa `seedAgentTemplates` em `packages/db/src/seed.ts`.
