---
id: F70-S34
title: Respostas rápidas da cadência da Arcada — "Agora não" encerra, "Quero…" reabre com a IA
phase: F70
status: available
priority: high
estimated_size: M
depends_on: [F70-S06, F70-S30]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md
---
# F70-S34 — Respostas rápidas da cadência

## Contexto (29/09)

Modelos de Marketing, pt_BR, sem variáveis, rodapé "Para não receber mais mensagens, responda SAIR.", duas respostas rápidas cada:
- `arcada_lembrete_dia_3`: "Quero seguir" / "Agora não";
- `arcada_lembrete_dia_7`: "Quero retomar" / "Agora não";
- `arcada_toque_30_dias`: "Quero a prévia" / "Agora não".

## Escopo

### files_allowed

- `packages/channels/src/meta/whatsapp/**` *(parse do botão de resposta rápida)*
- `apps/workers/src/inbound/**`
- `apps/workers/src/flows/**`
- `packages/flow-engine/src/**`
- testes ao lado

*(Antes de editar fora da lista, nota de correção no slot, no padrão da F69-S03.)*

## Escopo (faz)

- O clique numa resposta rápida chega como mensagem do tipo `button` (payload e texto); o inbound normaliza de forma que o flow consiga ramificar pelo payload/texto, sem depender de acento ou caixa.
- **"Agora não":** encerra a cadência daquele contato (a etiqueta `esfriou`/o estado da cadência param; nenhum lembrete seguinte sai). Não liga a IA.
- **"Quero…":** reabre a conversa com a IA **só se a origem estiver comprovada**, respeitando a trava do workspace (F70-S30) e a marca humana; sem origem, a conversa fica para o humano.
- "SAIR" (rodapé): opt-out de marketing do contato, pelo mecanismo de consentimento/supressão que já existe (F59).
- Documentar no F70-S06 como o flow de cadência usa isso.

## Definition of Done

- [ ] teste: "Agora não" → cadência encerrada, nenhum lembrete seguinte enfileirado
- [ ] teste: "Quero…" com origem comprovada → IA reabre; sem origem → não reabre
- [ ] teste: "SAIR" → supressão de marketing registrada
