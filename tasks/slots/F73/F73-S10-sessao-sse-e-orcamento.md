---
id: F73-S10
title: API de sessão do Copiloto com streaming SSE de produção, contexto de página, histórico, limites e orçamento mensal próprio
phase: F73
status: done
priority: critical
estimated_size: L
model: opus
ui: false
depends_on: [F73-S01, F73-S02, F73-S03, F73-S04]
blocks: [F73-S14, F73-S15, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-003-identidade-do-membro-nas-acoes-de-ia.md
  - docs/AGENTS_LANGGRAPH.md
agent_id: backend-engineer
claimed_at: 2026-10-17T06:38:37Z
completed_at: 2026-10-17T06:56:54Z

---
# F73-S10 — Sessão, SSE e orçamento

## Objetivo

O membro pergunta e recebe a resposta em streaming, em produção: a sessão é criada, o turno é autorizado (limite de taxa, um turno ativo, orçamento), o runtime é chamado com o pedido montado (histórico, memória, contexto de página resolvido e só as ferramentas permitidas), os eventos internos viram o contrato público, e mensagens, cartões e uso ficam gravados. O orçamento do Copiloto é separado do dos agentes de atendimento.

## Contexto

Hoje só o Playground tem SSE (`routes/agents/playground.ts`), e ele é o molde de proxy, abort e erro seguro. O contrato público é o `CopilotStreamEventSchema` (S02); o interno é o da spec §5.4, implementado no runtime (S04).

## Escopo (faz)

- `packages/agents-client/src/copilot.ts` (+ export em `index.ts`): `runCopilot(request, { signal })` → `AsyncIterable<CopilotRuntimeEvent>`, validando cada frame com o Zod de `@hm/shared/copilot/internal`, mais o erro tipado. **Teste de contrato** consumindo as fixtures JSON do runtime (`apps/agent-runtime/tests/copilot/fixtures/*.json`, lidas do disco no teste).
- `packages/agents-core/src/policy-resolver.ts`: `monthToDateSpendUsd(tx, ws, { surface })`, com padrão `'agent'` (o cap dos agentes deixa de contar o Copiloto; o comportamento atual dos agentes fica igual quando não há linhas `copilot`). Mais `copilotBudgetState(settings, spend)` → `ok|alert|queries_only|paused`. Testes.
- `apps/api/src/services/copilot/identity/budget.ts`: substituir a query local do S03 pela função do `agents-core` (único arquivo de `identity/` que este slot toca).
- `apps/api/src/services/copilot/turns/**`:
  - `assemble.ts`: monta o `CopilotRunRequest`:
    - histórico: últimas 12 mensagens da sessão (`role` + `content`; para o assistente, o veredito);
    - memória: `copilotMemoryRepo.listActiveForPrompt`; fato com `source_type='integration'` vai marcado `untrusted` (dado de sistema de terceiro);
    - contexto de página: Zod `.strict()`, cada id re-resolvido com `resolveVisible` (`services/copilot/identity/scope.ts`, F73-S03); id não visível é descartado em silêncio; o rótulo do chip sai daí;
    - ferramentas: `listToolDescriptorsFor(principal)`;
    - `policy`: modelo de `copilot_settings.model` ou do padrão da plataforma, `max_iterations: 8`, `max_tool_calls: 16`, `turn_timeout_s: 60`;
  - `run.ts`: orquestra o turno.
    1. Limite de taxa: 6/min e 300/dia por membro, em Redis (`rate-limit.ts` por import).
    2. Um turno `running` por membro: outro pedido → `error turn_in_progress`.
    3. Guarda de orçamento antes do turno (estimativa conservadora do `cost-guard`).
    4. `copilotTurnsRepo.createRunning` (idempotente por `client_request_id`: um reenvio com o mesmo id não cria turno novo e devolve 409 com o `turn_id`).
    5. `mintGrant`.
    6. `runCopilot`, mapeando eventos internos para públicos:
       - `status{tool_key}` → `status{ phase, label }`, com o rótulo do **catálogo**;
       - `tool_call_completed.envelope.public_event` → `tool_result` / `action_receipt` / `action_proposed` / `action_blocked` (o `tool_result` sai do envelope do Node, nunca do modelo);
       - `verdict_delta` repassado;
       - `final` → `final`, com `data_refs` filtrados pelos `result_id` vistos neste turno.
    7. Ao final, numa transação: grava a mensagem do usuário e a do assistente (`content` = veredito, `blocks`, `tool_results` com os cartões, `proposal_id` quando houver), o `copilot_turns.complete(usage)` e uma linha de `llm_usage_logs` com `surface='copilot'`, `copilot_turn_id` e o custo do `final`.
    8. Desconexão do cliente aborta o runtime e marca o turno `cancelled`; o usuário e o que já chegou ficam gravados.
  - `title.ts`: título da sessão a partir da 1ª pergunta (primeiras 60 letras, sem LLM).
- Rotas `apps/api/src/routes/copilot/sessions/**` (spec §5.2):
  - `POST /api/copilot/sessions` (`origin`);
  - `GET /api/copilot/sessions` (só as do membro, cursor);
  - `GET /api/copilot/sessions/:id/messages` (dono);
  - `PATCH` (renomear) e `DELETE` (arquivar);
  - `POST /api/copilot/sessions/:id/messages` → SSE, com headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` e `X-Accel-Buffering: no`, heartbeat de comentário a cada 15 s e `turn_started` em ≤ 800 ms p95;
  - `POST /api/copilot/turns/:id/cancel` (dono).
  Todas com `copilotAvailable` (S03).
- Erros sempre como frame `error { code, ref }` (o `ref` correlaciona com o log). Nunca texto do runtime ou do modelo cru.
- Métrica mínima por turno no log estruturado: duração, iterações, `tool_calls`, `tainted`, custo e modelo. Sem conteúdo.

## Fora de escopo

- Dashboard de uso, telemetria e retenção (S15). Interface (F74). Briefing (S12).

### files_allowed

- `packages/agents-client/src/copilot.ts`
- `packages/agents-client/src/copilot.test.ts`
- `packages/agents-client/src/index.ts`
- `packages/agents-core/src/policy-resolver.ts`
- `packages/agents-core/src/policy-resolver.test.ts`
- `apps/api/src/services/copilot/turns/**`
- `apps/api/src/services/copilot/identity/budget.ts`
- `apps/api/src/routes/copilot/sessions/**`

### files_forbidden

- `apps/api/src/routes/agents/**` (Playground; só referência)
- `apps/agent-runtime/**`

## Definition of Done

- [ ] Teste de contrato Node ↔ runtime com as fixtures do S04 verde
- [ ] Teste de integração com runtime fake (servidor HTTP local emitindo eventos internos):
  - sequência pública correta;
  - `tool_result` vindo do envelope do Node;
  - `data_refs` inventado removido;
  - desconexão aborta e grava `cancelled`;
  - turno concorrente → `turn_in_progress`;
  - reenvio com o mesmo `client_request_id`;
  - 7º pedido no minuto → `rate_limited`;
  - orçamento `paused` → `budget_exceeded` sem chamar o runtime;
  - em `queries_only`, a pergunta passa e a ferramenta de escrita é recusada pelo callback;
  - `llm_usage_logs.surface='copilot'` gravado;
  - cap dos agentes inalterado (teste em `agents-core`)
- [ ] Contexto de página com id de outro workspace ou invisível é descartado (teste); campo extra no contexto → 400
- [ ] Histórico: sessão de outro membro → 404; arquivada some da lista
- [ ] Em só leitura o `POST /messages` passa (o guard do S03); em view-as, 403
- [ ] Nenhum `any`; os frames validam no `CopilotStreamEventSchema` (o teste valida cada frame emitido)

## Validação

```bash
pnpm --filter @hm/agents-client typecheck
pnpm --filter @hm/agents-core typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node packages/agents-client/node_modules/vitest/vitest.mjs run --root packages/agents-client src/copilot.test.ts --maxWorkers=1
node packages/agents-core/node_modules/vitest/vitest.mjs run --root packages/agents-core --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/copilot/turns src/routes/copilot/sessions --maxWorkers=1
```

## Notas

- Agente: `backend-engineer` (opus).
- O proxy Next → API já atende SSE (Playground). Se o `next.config` precisar de ajuste para não bufferizar, registre em `tasks/COMMS.md` para a F74-S12. **Não** edite `apps/web` aqui.
- O modelo padrão e o preço por token vêm da whitelist da plataforma (`llm_models_whitelist`). A estimativa do `cost-guard` usa o `max_tokens_per_call` do Copiloto.
