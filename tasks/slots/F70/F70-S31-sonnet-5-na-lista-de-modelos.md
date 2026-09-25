---
id: F70-S31
title: Sonnet 5 na lista de modelos e no agente da Arcada
phase: F70
status: available
priority: medium
estimated_size: S
depends_on: [F70-S06]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md
---
# F70-S31 — Sonnet 5 na lista de modelos e no agente da Arcada

## Objetivo

O Claude Sonnet 5 poder ser escolhido nos agentes do Leadium e ser o modelo do agente da Arcada. Decisão do Rogério em 25/09.

## Contexto

- A S06 usou `anthropic/claude-sonnet-4`, o Sonnet mais novo da whitelist do Leadium naquele momento.
- O roteamento é pelo OpenRouter: o id do modelo precisa ser confirmado na lista pública de modelos do OpenRouter, com fonte e data. Não se inventa id.
- Decisão registrada junto: o "toque de 30 dias" da cadência conta a partir da etiqueta `esfriou` (dia 37 desde a última mensagem), que é como a S06 já implementou.

## Escopo

### files_allowed

- whitelist e catálogo de modelos (localizar: `packages/shared/src/**`, `packages/db/src/seed/**`, `apps/agent-runtime/app/**` — anotar o caminho exato no slot antes de editar)
- `packages/db/src/seed/agent_templates_arcada*.ts`
- `packages/db/drizzle/**` *(se o catálogo for dado no banco)*
- testes ao lado

## Escopo (faz)

- Confirmar o id exato do Sonnet 5 no OpenRouter (fonte e data no slot) e o preço, para o teto de custo.
- Incluir o modelo na whitelist e no catálogo, com a mesma política de planos dos outros Sonnet, e documentar.
- Seed da Arcada passa a usar o Sonnet 5. O agente já existe e está inativo, então a mudança entra como rascunho de versão, e o Rogério publica.

## Definition of Done

- [ ] teste: o modelo passa pela whitelist do runtime e do Node
- [ ] seed re-rodado no dev gera o rascunho com o modelo novo, sem tocar no live
- [ ] fonte do id do modelo registrada
