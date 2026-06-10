---
id: F2-S10
title: Column-level access control para tools de database
phase: F2
status: in-progress
priority: medium
estimated_size: S
depends_on: [F2-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:19:20Z

---
# F2-S10 — Column-level access control

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §6.5; `docs/ROADMAP.md` F2-S10
> **blocks:** F2-S06

## Objetivo
Módulo puro que define e impõe quais colunas cada tool de database pode ler/retornar (allowlist por tool/tabela), para que um agente nunca exfiltre colunas sensíveis (ex.: secrets, PII não-necessária) mesmo consultando sob RLS.

## Escopo (faz)
- `app/tools/access_control.py`: `allowed_columns(tool_key, table) -> set[str]`, `project(row, allowed) -> dict` (filtra colunas), e a configuração allowlist por tool. Pure, sem IO — consumido por F2-S06.

## Fora de escopo
- As tools em si (F2-S06), RLS de linha (já é do Postgres), policy de tools (F2-S08).

## Arquivos permitidos
- `apps/agent-runtime/app/tools/access_control.py`

## Definition of Done
- [ ] Allowlist por tool/tabela; `project()` remove colunas não permitidas.
- [ ] Default deny (coluna desconhecida não passa).
- [ ] `ruff` + `pytest` (projeção/deny) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
Módulo puro de propósito — F2-S06 importa e aplica. Mantido em slot próprio para a regra de exfiltração ser auditável isoladamente.
