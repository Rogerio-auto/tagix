---
id: F69-S09
title: Servidor MCP de anúncios — o agente sugere e prepara, o humano aprova
phase: F69
status: available
priority: medium
estimated_size: L
depends_on: [F69-S05]
blocks: []
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: python-engineer

---
# F69-S09 — Servidor MCP de anúncios — o agente sugere e prepara, o humano aprova

## Objetivo

Um agente de IA analisa as campanhas do cliente pelo servidor MCP de anúncios da Meta e prepara ações — que só são aplicadas depois de aprovação humana e dentro de um teto de gasto.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §3 e §5.5. A Meta abriu o servidor MCP de anúncios para qualquer app (2026-07-16); para operar contas de outras empresas, que é o caso de agência, exige Advanced Access em `ads_mcp_management`. O agent-runtime em Python (LangGraph) é onde os agentes vivem.

## Escopo

### files_allowed

- `apps/agent-runtime/**`
- `apps/api/src/services/meta/ads-mcp/**`
- `apps/api/src/routes/ads/**`
- `packages/db/src/schema/ad_action_proposals.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `apps/web/features/ads/**`

### files_forbidden

- `apps/workers/src/outbound/**`

## Escopo (faz)

- Cliente MCP no agent-runtime autenticado com o token da conexão do workspace, nunca com credencial global.
- Ferramentas de leitura liberadas; ferramentas que mudam orçamento, status ou público viram **proposta**.
- Proposta mostra: o que muda, por quê, valor antes e depois, impacto estimado; aprovar aplica pela F69-S05, com a mesma trilha.
- Teto de gasto por workspace e por ação; orçamento de tokens do agente pelo budget guard existente.

## Fora de escopo

- Criação autônoma de campanha.

## Definition of Done

- [ ] Nenhuma ferramenta de mutação é executada sem aprovação registrada; teste cobre.
- [ ] Aprovação aplica pela F69-S05 e grava `ad_changes`.
- [ ] Teto de gasto recusa proposta acima do limite.
- [ ] Token do workspace nunca vaza entre workspaces; teste de isolamento.
- [ ] Custo de modelo contabilizado no uso do workspace.

## Validação

```bash
cd apps/agent-runtime && uv run ruff check . && uv run pytest
pnpm --filter @hm/api test
pnpm lint
```

## Notas

- A régua: o agente nunca gasta um centavo que um humano não aprovou.
