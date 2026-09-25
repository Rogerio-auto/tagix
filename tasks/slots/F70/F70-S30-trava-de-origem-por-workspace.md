---
id: F70-S30
title: Trava de origem da IA como configuração do workspace
phase: F70
status: available
priority: high
estimated_size: M
depends_on: [F70-S28]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S07-ligar-origem-atribuicao-e-trava-da-ia.md
  - tasks/slots/F70/F70-S19-achados-da-auditoria-apos-s15-s16.md
---
# F70-S30 — Trava de origem da IA como configuração do workspace

## Objetivo

Cada workspace decide se a IA só atende conversas com origem comprovada (anúncio, site, Instagram) ou qualquer conversa. Decisão do Rogério em 25/09: a trava vira uma funcionalidade do produto.

## Contexto

- A trava (F70-S07/S08/S19/S23) hoje vale para todos os workspaces. Faz sentido para número pessoal, onde família e amigos não podem receber IA, e atrapalha um cliente com número só comercial, que quer IA em todo lead.
- Decisões de 25/09 que ficam registradas: **Direct do Instagram conta como origem comprovada** (comportamento atual, mantido); campanhas e conversas antigas continuam sob a regra.

## Escopo

### files_allowed

- `packages/db/drizzle/**` *(migração, se a configuração virar coluna; senão, `workspaces.settings`)*
- `packages/db/src/schema/index.ts`
- `packages/shared/src/conversation-origin*.ts`
- `packages/flow-engine/src/ports/outbound.port.ts`
- `packages/flow-engine/src/**/*.test.ts`
- `apps/workers/src/agents/run.ts`
- `apps/workers/src/agents/reengagement.ts`
- `apps/workers/src/agents/*.test.ts`
- `apps/workers/src/inbound/ai-gate.ts`
- `apps/workers/src/campaigns-inbound/db-ports.ts`
- `apps/api/src/internal/tools/agent-transfer-handlers.ts`
- `apps/api/src/routes/settings/**`
- `apps/api/src/routes/workspace*/**`
- `apps/web/features/settings/**`
- `apps/web/app/(app)/settings/**`

*(Antes de editar fora da lista, nota de correção no slot, no padrão da F69-S03.)*

## Escopo (faz)

- Configuração por workspace: `aiRequiresProvenOrigin` (nome final a critério do engenheiro, documentado).
  - **Padrão ligado** (fail-closed) em todo workspace, incluindo o do Rogério.
  - Um cliente com número só comercial desliga.
- Todos os caminhos automáticos da trava (os 5 da auditoria da S08 mais o gate `authorizeAiReply`) passam a consultar a configuração numa fonte única. Com a trava desligada, a regra antiga (origem elegível ou marca humana) vira "sempre elegível", e o resto fica igual.
- Só OWNER/ADMIN altera a configuração, com auditoria (quem, quando, valor anterior).
- Tela em Configurações → IA: um interruptor com uma frase clara, por exemplo "Responder só quem chegou por anúncio, site ou Instagram. Recomendado se este número também é pessoal." DS v2, dark-first.

## Definition of Done

- [ ] teste: trava ligada → conversa `sem-origem` sem IA; desligada → IA atende
- [ ] teste: cada caminho automático respeita a configuração (flow `ai_action`, retomada, handoff de campanha, transferência, gate do worker)
- [ ] teste: só OWNER/ADMIN altera; a alteração é auditada
- [ ] tela com o interruptor e o texto explicativo
