---
id: F26-S06
title: Agent sandbox — mode:'sandbox' no /run (tool-executor mock, no-persist, custo is_test)
phase: F26
status: done
priority: high
estimated_size: M
depends_on: [F26-S01]
agent_id: python-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
  - docs/AGENTS_LANGGRAPH.md
  - docs/PRD.md
claimed_at: 2026-06-13T14:56:18Z
completed_at: 2026-06-13T14:59:54Z

---
# F26-S06 — Agent sandbox (agent-runtime)

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §7; PRD §80
> **blocks:** F26-S10

## Objetivo

Modo **sandbox** no agent-runtime para o playground (PRD §80): rodar o grafo de um agente em teste **sem nenhum side-effect de produção** — `register_conversion`/`send_message`(canal real)/`trigger_flow` viram **mock** que só registram "teria feito X"; **nada é persistido** em conversations/messages; o custo LLM vai com `is_test=true` em `llm_usage_logs` (não conta no cap de produção). Permite override efêmero de system prompt/modelo/tools (dentro da `allowed_models` da policy). Policy enforcement (caps/whitelist) continua valendo.

## Contexto

`POST /run` (SSE, LangGraph+OpenRouter) já executa o grafo. Este slot adiciona `mode:'sandbox'` que injeta um **tool-executor mock** e desliga a persistência, mantendo o stream de execução (tokens, tool calls + resultados, latência por nó) para inspeção. `is_test` vem do F26-S01.

## Escopo (faz)

- `apps/agent-runtime/app/routes/run.py` (editar): aceitar `mode: 'sandbox'` no payload (default `'live'`), override efêmero de prompt/model/tools.
- `apps/agent-runtime/app/sandbox/**` (novo): tool-executor mock (intercepta business tools com side-effect → retorna resultado simulado + registra "would-do"), e desativação de persistência (sem gravar conversation/message; usage log marcado `is_test=true`).
- Garantir que a policy enforcement (allowed_models/caps) é aplicada igual ao live.
- Testes (sandbox não persiste; tools com side-effect viram mock; model fora da whitelist → 403; custo marcado is_test).

## Fora de escopo

- UI do playground (F26-S10). Coluna is_test (F26-S01). Exposição ao cliente no workspace (follow-up).

## Arquivos permitidos

- `apps/agent-runtime/app/routes/run.py`
- `apps/agent-runtime/app/sandbox/**`
- `apps/agent-runtime/tests/**` (testes do sandbox)

## Arquivos proibidos

- `apps/agent-runtime/app/main.py` (wire/registro pelo orchestrator se precisar), nós do grafo de produção sem relação

## Definition of Done

- [ ] `mode:'sandbox'` roda o grafo SEM persistir (zero escrita em conversations/messages) e com tools de side-effect mockadas (registram would-do).
- [ ] Custo do teste em `llm_usage_logs` com `is_test=true`; cap de produção intacto; enforcement de whitelist/caps mantido.
- [ ] Stream SSE continua entregando tokens + tool calls + latência p/ inspeção.
- [ ] `uv run ruff check` + `uv run pytest` (sandbox) verdes; typecheck do monorepo TS não afetado.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- Especialista: **python-engineer** (agent-runtime). A invariante **zero side-effect** é o ponto crítico — testes devem PROVAR que nenhuma mensagem real sai e nada é gravado em produção. A API/UI chama via o proxy interno existente (AGENT_RUNTIME_TOKEN); se precisar de uma rota API dedicada de playground, é glue do orchestrator/F26-S10.
