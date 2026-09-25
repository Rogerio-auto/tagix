---
id: F70-S06
title: Agente de atendimento da Arcada
phase: F70
status: blocked
priority: high
estimated_size: M
depends_on: [F70-S04, F70-S05, F70-S07]
blocks: []
source_docs:
  - rogerio-os/tasks/central-operacao/CO-10-agente-de-atendimento-da-arcada.md
---
# F70-S06 — Agente de atendimento da Arcada

> Espelho do **CO-10** da Central de Operação (`rogerio-os/tasks/central-operacao/`).

## Objetivo

Quem chega por anúncio, Instagram ou site ser atendido 24h e passar para o Rogério na hora certa.

## Contexto

O Leadium tem runtime de agente (LangGraph + OpenRouter, `transfer_to_human`, prompt versionado). Conversa nova nasce com `ai_mode='off'`: sem um Flow, a IA não atende.

## Escopo

### files_allowed

- `packages/db/src/seed/agent_templates*.ts` *(template novo, opcional)*
- configuração do agente e do flow pela UI ou seed

## Escopo (faz)

- Agente "Arcada" com prompt versionado: os 3 níveis (1.000 / 2.500 / 5.000), qualificação (clínica, tem site, decisor, prazo), envio de portfólio, agendamento.
- Passagem para humano: o agente trata objeções e negocia dentro dos limites aprovados e passa para o Rogério **quando o cliente está pronto para fechar**; também em pedido explícito de humano ou irritação.
- Limites aprovados em 24/09: parcelamento em 2x sem juros, até 3x se o cliente insistir (sem desconto); à vista, 10% de desconto, máximo 15%; entrega em até 5 dias úteis.
- Sem resposta: lembrete dentro das 24h, outro no 3º e no 7º dia (modelo aprovado), etiqueta `esfriou` e um toque 30 dias depois.
- Flow `new_lead` / `new_message` → `ai_action ACTIVATE` só para conversas iniciadas pelo cliente com origem comprovada (F70-S05).
- Sonnet via OpenRouter (whitelist do Leadium) e teto de custo por conversa.
- Base de conhecimento (`kb_*`) com FAQ e casos.

## Fora de escopo

- Responder prospecção iniciada pelo Rogério (IA desligada nelas, F70-S04).

## Passos do Rogério 🧑

- Aprovar o prompt e o roteiro antes de ligar.
- Fazer 10 conversas de teste como cliente.

## Definition of Done

- [ ] 10 conversas de teste aprovadas pelo Rogério
- [ ] handoff testado nos 4 gatilhos
- [ ] custo médio por conversa medido
