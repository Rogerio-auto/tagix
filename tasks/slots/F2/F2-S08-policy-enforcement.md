---
id: F2-S08
title: Policy enforcement no runtime (filtra tools, valida modelo, max_iterations)
phase: F2
status: in-progress
priority: high
estimated_size: S
depends_on: [F2-S05, F2-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:52:22Z

---
# F2-S08 — Policy enforcement (defense-in-depth no runtime)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §8; `docs/ROADMAP.md` F2-S08
> **blocks:** —

## Objetivo
O `agent-runtime` aplica o `policy_snapshot` recebido na request (resolvido no Node a partir de `workspace_agent_policies`): filtra as tools permitidas, valida o modelo contra a whitelist, ajusta `max_iterations`, e bloqueia execução se o modelo está fora da whitelist — defense-in-depth, mesmo que o Node já tenha validado.

## Escopo (faz)
- `app/policy.py`: `apply_policy(state, snapshot)` — filtra `registry` por `allowed_tools`, valida `model ∈ allowed_models`, clampa `max_iterations`, levanta erro tipado se modelo proibido.
- Integração nos nodes de F2-S05 (via interface já exposta — sem editar `app/nodes/**`, que é de F2-S05; expor `apply_policy` para o graph importar).

## Fora de escopo
- Resolução do snapshot no Node (F2-S08 assume o snapshot pronto); hard cap de custo (F2-S09); super-admin UI (F2.5).

## Arquivos permitidos
- `apps/agent-runtime/app/policy.py`

## Definition of Done
- [ ] Tools fora da policy não chegam ao `call_model`; modelo fora da whitelist bloqueia com erro claro.
- [ ] `max_iterations` clampado ao teto da policy.
- [ ] `ruff` + `pytest` (casos: tool filtrada, modelo proibido, clamp) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
O contrato de `policy_snapshot` deve casar com o que o Node monta (F2-S09 + resolução no caller). Documentar o shape.
