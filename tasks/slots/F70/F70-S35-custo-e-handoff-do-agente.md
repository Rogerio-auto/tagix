---
id: F70-S35
title: Teto de custo por conversa, custo médio medido e handoff testado nos 4 gatilhos
phase: F70
status: available
priority: high
estimated_size: M
depends_on: [F70-S26]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md
---
# F70-S35 — Custo por conversa e handoff

## Contexto

Pendências da F70-S06: hoje só existe teto mensal por workspace (`cost-guard`); não há teto por conversa nem medição do custo médio; o handoff nos 4 gatilhos (pronto para fechar, pedido explícito de humano, irritação, fora dos limites) nunca foi testado de ponta a ponta.

## Escopo

### files_allowed

- `packages/agents-core/src/**`
- `apps/workers/src/agents/**`
- `apps/agent-runtime/**`
- `packages/db/drizzle/**` *(se o teto precisar de coluna: próximo número livre no journal)*
- `packages/db/src/schema/agents.ts`
- `apps/api/src/routes/agents/**`
- testes ao lado

## Escopo (faz)

- Teto de custo por conversa, configurável por agente (default seguro); estourou → a IA para naquela conversa e passa para humano (`transfer_to_human` com motivo), sem responder mais.
- Custo por conversa agregado a partir das execuções (tokens × preço do `llm_models_whitelist`) e exposto na API do agente (custo médio e p95 por conversa numa janela).
- Teste de ponta a ponta com runtime falso para os 4 gatilhos de handoff: a conversa sai de `on`, fica pendente para humano e o evento `conversation.handoff` vai para a outbox.

## Definition of Done

- [ ] teste: teto por conversa atingido → sem nova resposta, handoff registrado
- [ ] teste: custo médio calculado a partir de execuções semeadas
- [ ] teste: 4 gatilhos → handoff + evento
