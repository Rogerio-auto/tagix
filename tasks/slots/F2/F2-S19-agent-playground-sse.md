---
id: F2-S19
title: Playground do agente com SSE streaming (proxy via API Node)
phase: F2
status: done
priority: medium
estimated_size: M
depends_on: [F2-S16, F2-S05, F2-S18]
agent_id: backend-engineer
claimed_at: 2026-06-10T04:21:26Z
completed_at: 2026-06-10T04:21:26Z

---
# F2-S19 — Playground (SSE streaming)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §10; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F2-S19
> **blocks:** —

## Objetivo
Playground para testar o agente: o frontend abre um stream SSE para a API Node, que faz proxy do `agentsClient.run` do runtime; tokens, tool calls e resultado final aparecem em tempo real, sem afetar conversas reais.

## Escopo (faz)
- `apps/api/src/routes/agents/playground.ts`: `POST/GET /api/agents/:id/playground` (SSE) — autentica sessão, resolve policy + cost-guard, faz proxy do stream do runtime → SSE para o browser.
- `apps/web/features/agents/playground/**`: `AgentPlayground` (input + transcript com streaming de tokens/tool calls, render de eventos), consumido pela aba Playground (F2-S18).

## Fora de escopo
- CRUD (F2-S16), grafo/runtime (F2-S05).

## Arquivos permitidos
- `apps/api/src/routes/agents/playground.ts`
- `apps/web/features/agents/playground/**`

## Definition of Done
- [ ] SSE faz proxy do stream do runtime; tokens/tool calls renderizam ao vivo.
- [ ] Playground não cria mensagens reais; respeita policy/cost-guard.
- [ ] `pnpm --filter @hm/api typecheck` + `pnpm --filter @hm/web build` + lint verdes.

## UX considerations
- §3 feedback de streaming (cursor/“digitando”); estados de erro com ref copiável; tokens DS v2 (zero hex); acessível (aria-live no transcript).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
Router `playground.ts` montado em `app.ts` pelo orchestrator. Reusa o cost-guard/policy-resolver de F2-S09.
