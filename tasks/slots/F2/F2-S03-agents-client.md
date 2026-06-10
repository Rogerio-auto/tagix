---
id: F2-S03
title: Pacote @hm/agents-client (cliente Node tipado p/ agent-runtime)
phase: F2
status: done
priority: critical
estimated_size: M
depends_on: [F2-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:19:33Z
completed_at: 2026-06-10T03:19:33Z

---
# F2-S03 — @hm/agents-client (Node → agent-runtime)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §2, §10; `docs/ROADMAP.md` F2-S03
> **blocks:** F2-S09, F2-S11, F2-S16, F2-S19

## Objetivo
Cliente HTTP tipado (Node/TS) para o `agent-runtime`: `agentsClient.run(req)` retorna um `AsyncGenerator` de eventos (token/tool_call/tool_result/final), além de health/cancel. Contrato de request/response em Zod, espelhando o schema FastAPI (idealmente derivado do OpenAPI export do Python).

## Escopo (faz)
- `src/types.ts`: Zod `AgentRunRequest` (workspaceId, conversationId, agentId, messages, policy_snapshot, max_iterations) + eventos de stream tipados.
- `src/client.ts`: `createAgentsClient({ baseUrl, token })` → `run()` (SSE/stream → AsyncGenerator), `health()`, `cancel(executionId)`. Auth via token interno compartilhado (header).
- `src/index.ts`: barrel.
- Erros tipados (`AgentRuntimeError` com ref).

## Fora de escopo
- A chamada a partir do worker (F2-S11), cost cap (F2-S09), UI playground (F2-S19).

## Arquivos permitidos
- `packages/agents-client/src/**`

## Definition of Done
- [ ] `agentsClient.run()` consome o stream do runtime e produz eventos tipados (zero `any`; validação Zod no boundary).
- [ ] Contrato bate com o endpoint do runtime (F2-S02/S05) — request/response documentados.
- [ ] `pnpm --filter @hm/agents-client typecheck` + lint verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/agents-client test
```

## Notas
Se o runtime expõe OpenAPI, considere gerar tipos a partir dele; senão manter o Zod como fonte da verdade e validar em ambos os lados via teste de contrato.
