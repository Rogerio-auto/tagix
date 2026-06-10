---
id: F5-S08
title: Agent tools — move_deal_stage + query_deal (agent-runtime)
phase: F5
status: blocked
priority: medium
estimated_size: S
depends_on: [F5-S02, F5-S05]
---
# F5-S08 — Agent tools de deal

> **source_docs:** `docs/features/PIPELINE.md` §11; `docs/AGENTS_LANGGRAPH.md` §6/§7; `docs/ROADMAP.md` F5-S09
> **blocks:** —

## Objetivo
Tools do agente IA para pipeline: `query_deal` (consulta deals do contato/conversa sob RLS) e `move_deal_stage` (move um deal de stage via o serviço `moveDealToStage`, com `actor.type='agent'`). Habilitadas por padrão no template `sales`.

## Escopo (faz)
- `apps/agent-runtime/app/tools/database/query_deal.py`: consulta asyncpg sob `with_workspace` (deals do contato/pipeline), categoria `database` + column-access (F2-S10).
- `apps/agent-runtime/app/tools/workflow/move_deal_stage.py` (ou callback Node): move via o endpoint Node `POST /api/deals/:id/move-stage` (reusa `moveDealToStage` de F5-S05, validação/transition/history/automation no servidor) — não duplica regra no Python.

## Fora de escopo
- Serviço de move (F5-S05), schema (F5-S02), seed do template sales (F5-S15 habilita a tool).

## Arquivos permitidos
- `apps/agent-runtime/app/tools/database/query_deal.py`
- `apps/agent-runtime/app/tools/workflow/move_deal_stage.py`

## Definition of Done
- [ ] `query_deal` retorna deals sob RLS; `move_deal_stage` move via o serviço Node (respeitando transition rules e gravando history com actor agent).
- [ ] `ruff` + `pytest` (asyncpg/http mockados) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
- Especialista sugerido: **python-engineer**.
- `move_deal_stage` como tool de workflow (callback Node) garante que a validação de transition rules e a automação rodem uma única vez (no servidor), não reimplementadas no runtime.
