---
id: F2-S11
title: Worker de agentes — ai_mode='on' + inbound → agentsClient.run (stream)
phase: F2
status: done
priority: critical
estimated_size: M
depends_on: [F2-S03, F2-S05, F2-S09]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:52:15Z
completed_at: 2026-06-10T03:52:16Z

---
# F2-S11 — Integração worker → agent-runtime

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §10; `docs/ROADMAP.md` F2-S11; F1-S26 (`MqInboundFlowEnqueue` → `hm.q.flows`)
> **blocks:** F2-S12, F2-S21

## Objetivo
Worker Node que consome o evento de "rodar agente" (enfileirado por F1-S26 quando `ai_mode='on'` numa conversa com nova mensagem inbound), resolve a policy + cost cap, chama `agentsClient.run(...)`, consome o `AsyncGenerator` de eventos e materializa o resultado: emite tokens via socket (`agent_execution:*`), persiste a mensagem do agente (outbound) e dispara o envio.

## Escopo (faz)
- `apps/workers/src/agents/worker.ts`: consumer de `hm.q.flows` (ou fila dedicada de agent-run), parse Zod do envelope.
- `apps/workers/src/agents/run.ts`: orquestra resolve-policy (F2-S09) → cost-guard → `agentsClient.run` → consome stream → persiste msg do agente + enfileira outbound (reusa `hm.q.outbound`).
- `apps/workers/src/agents/index.ts`: barrel + composição no bootstrap (`apps/workers/src/bootstrap` é de F1-S26; expor `startAgentWorker` e reportar wiring).

## Fora de escopo
- Aggregation buffer (F2-S12), follow-up cron (F2-S21), métricas (F2-S13).

## Arquivos permitidos
- `apps/workers/src/agents/worker.ts`
- `apps/workers/src/agents/run.ts`
- `apps/workers/src/agents/index.ts`

## Definition of Done
- [ ] Consome o evento de agent-run, chama o runtime e persiste a resposta do agente (outbound) + emite `agent_execution:*`.
- [ ] Aplica cost-guard (F2-S09) antes de chamar; respeita policy.
- [ ] `pnpm --filter @hm/workers typecheck`/lint/test verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
Reusa o pipeline outbound de F1 (envia a resposta do agente como qualquer mensagem). O start do worker entra no bootstrap de F1-S26 (wiring do orchestrator).
