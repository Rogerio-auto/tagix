---
id: F2-S20
title: Tools workflow modulares + register_conversion (respeitando policies)
phase: F2
status: review
priority: medium
estimated_size: M
depends_on: [F2-S07, F2-S06]
agent_id: backend-engineer
claimed_at: 2026-06-10T04:06:03Z
completed_at: 2026-06-10T04:06:04Z

---
# F2-S20 — Workflow tools modulares + register_conversion

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §6/§7.4; `docs/ROADMAP.md` F2-S20 (integra com schema de conversões de F5-S13)
> **blocks:** —

## Objetivo
As tools de workflow concretas (callback Node, via base de F2-S07): `transfer_to_human`, `escalate`, `mark_resolved`, `change_conversation_status`, e **`register_conversion`** — esta respeitando `workspace_agent_policies.allow_agent_conversions` + `agent_conversion_require_approval`.

## Escopo (faz)
- `apps/agent-runtime/app/tools/workflow/**`: cada tool como módulo (Pydantic args + `CallbackTool` apontando ao `toolKey` no Node). `register_conversion` checa as flags de policy antes de chamar (defense-in-depth; o Node revalida).

## Fora de escopo
- O endpoint Node `/internal/tools/*` e a base callback (F2-S07); o schema de conversões (F5) — `register_conversion` integra quando existir, senão stub + report.

## Arquivos permitidos
- `apps/agent-runtime/app/tools/workflow/**`

## Definition of Done
- [ ] Tools de workflow registradas no registry (F2-S06) e chamam o Node via callback (F2-S07).
- [ ] `register_conversion` respeita `allow_agent_conversions`/`require_approval`; bloqueia/limita quando proibido.
- [ ] `ruff` + `pytest` (mock do callback) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
A integração de conversão com o schema de F5-S13 é por contrato; até F5 existir, `register_conversion` faz o callback e o Node responde "não suportado ainda" — documentar.
