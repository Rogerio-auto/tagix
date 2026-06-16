---
id: F34-S07
title: E2E + docs do roteamento agente↔departamento e handoff
phase: F34
status: review
priority: medium
estimated_size: M
depends_on:
  - F34-S02
  - F34-S03
  - F34-S04
  - F34-S05
  - F34-S06
blocks: []
source_docs:
  - docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md
agent_id: qa-engineer
claimed_at: 2026-06-16T04:34:16Z
completed_at: 2026-06-16T04:49:44Z

---
# F34-S07 — E2E + docs

## Objetivo

Fechar a F34 com cobertura e2e do caminho ponta-a-ponta (configurar agente↔dept → IA engaja o agente certo → troca manual no cockpit) e consolidar a documentação da feature.

## Contexto

Slot de fechamento: depende de toda a F34. Valida a integração das peças (config, resolução, transferência manual e autônoma) e atualiza os docs para refletir o que foi entregue, marcando as decisões D1–D4 como implementadas.

## Escopo (faz)

- **`apps/web/e2e/agent-department-routing.spec.ts`** (novo) — fluxo: owner associa um agente a um departamento e o marca como entrada → conversa daquele departamento com `ai_mode='on'` é atendida por esse agente → operador troca o agente no cockpit e a mudança reflete (agente atual atualizado).
- **`docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md`** — marcar L1–L5 como entregues; D1–D4 como travadas/implementadas; remover o status "aguardando aprovação".
- **`docs/features/LIVECHAT_OPS.md`** — documentar a troca manual de agente no cockpit + a permissão `conversation.assign_agent`.
- **`docs/AGENTS_LANGGRAPH.md`** — documentar `transfer_to_agent` (tool + diretriz de prompt + contexto IA→IA) e o vínculo agente↔departamento.
- **`docs/features/PERMISSIONS.md`** — registrar `conversation.assign_agent` na matriz (§2).

## Fora de escopo

- Mudanças de implementação (todas nas S01–S06).
- Novos endpoints/telas.

## Arquivos permitidos

- `apps/web/e2e/agent-department-routing.spec.ts`
- `docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md`
- `docs/features/LIVECHAT_OPS.md`
- `docs/AGENTS_LANGGRAPH.md`
- `docs/features/PERMISSIONS.md`

## Arquivos proibidos

- `apps/web/e2e/**` exceto o spec novo nomeado acima
- Qualquer arquivo de implementação de S01–S06

## Definition of Done

- [ ] E2E cobre config → resolução por dept → troca manual no cockpit, verde localmente.
- [ ] Plano atualizado (L1–L5 entregues, D1–D4 travadas).
- [ ] LIVECHAT_OPS, AGENTS_LANGGRAPH e PERMISSIONS refletem a feature.
- [ ] `pnpm typecheck` + `pnpm lint` verdes; e2e roda (`pnpm --filter @hm/web test:e2e` ou equivalente do projeto).

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

Reusar fixtures/seed de e2e existentes (`apps/web/e2e/fixtures/`). Se o ambiente e2e não permitir exercitar a transferência autônoma (depende do runtime Python + LLM), cobrir a autônoma com os testes de S05/S06 e manter o e2e no caminho determinístico (config + resolução + troca manual). Não inventar cobertura que dependa de LLM real no CI.
