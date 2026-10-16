---
id: F73-S09
title: Ações externas do Copiloto (nível 4), mensagens a clientes, pausar/retomar/cancelar campanha e disparar flow, com checagem de política
phase: F73
status: blocked
priority: high
estimated_size: L
model: opus
ui: false
depends_on: [F73-S05, F73-S07]
blocks: [F73-S14, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
  - docs/features/CAMPAIGNS.md
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
---
# F73-S09 — Ações externas (nível 4)

## Objetivo

O Copiloto propõe ações que saem para clientes ou não têm volta: mensagem a um ou mais contatos (o lembrete de avaliação e o retorno da A5), pausar, retomar ou cancelar campanha (com "Pausar em vez disso") e disparar flow. Toda proposta mostra a prévia exata e a checagem de política: janela de envio, consentimento, conversa fechada → modelo aprovado e, na campanha, enviadas, agendadas e custo. Nada sai sem a caixa "Revisei", e a política é recalculada no confirmar.

## Contexto

É o nível de maior estrago. O envio reusa o caminho de saída existente (outbox transacional, consent gate e janela de 24 h), nunca um atalho. Achado pré-existente: `DELETE /api/campaigns/:id` usa `campaign.edit` e não confere o status. **Não** usar essa rota: a ação de campanha passa por um serviço de ciclo de vida novo (spec §8 R6). Consertar a rota é slot separado.

## Escopo (faz)

- `apps/api/src/services/campaigns/lifecycle.ts`, extraído de `routes/campaigns/lifecycle.ts` sem mudar o comportamento da rota:
  - `pauseCampaign`, `resumeCampaign`: as transições de status existentes;
  - `cancelCampaign(tx, actor, id)`: **novo e estrito**. Exige `campaign.cancel`; só cancela a partir de `scheduled|running|paused`; cancela os envios agendados ainda não despachados; devolve `{ already_sent, cancelled_scheduled, cost_used }`.
  A rota passa a delegar `pause` e `resume` (testes existentes verdes).
- `apps/api/src/services/messaging/send-on-behalf.ts`: `enqueueMemberMessage(tx, { actor, conversationId | contactId, content: { kind: 'text', text } | { kind: 'template', templateId, variables }, scheduledFor? })`.
  - Usa exatamente o mesmo caminho do `POST /api/conversations/:id/messages` (`buildOutboundJob` + outbox), extraído de `routes/conversations/messages.ts`, que passa a delegar sem mudar o comportamento (os testes `messages*.test.ts` seguem verdes).
  - Mensagem programada (`scheduledFor`) usa o mecanismo de agendamento existente da campanha ou do outbound. Se nenhum servir para mensagem individual, **não invente**: a v1 envia na hora, e o "agendar para amanhã 09:00" fica como nota de risco no slot e linha `warn` na política.
- Política em `apps/api/src/internal/copilot/act-external/policy.ts` (`policyCheck`), linhas `{ key, status, label, detail }`:
  - `send_window`: horário do mercado (`packages/shared/src/markets.ts`) e do workspace;
  - `consent`: `checkOutboundInTx` por destinatário; quem não pode receber vira item `skipped_policy` e o detalhe diz "11 de 12 · 1 será pulado";
  - `window_24h`: conversa fechada há mais de 24 h exige `template` aprovado (catálogo da F58); texto livre nesse caso dá `block`;
  - `template_approved`: nome do modelo e status;
  - campanha: `already_sent`, `scheduled`, `cost_used` (custo só aparece para quem tem `agent.view_costs`).
  - "Saldo de mensagens" **não** entra (o conceito não existe no produto; spec §11.1).
- Executores e ferramentas em `apps/api/src/internal/copilot/act-external/**`, registrados no stub `act-external/index.ts`:

| Ferramenta | Capacidade | Args | Prévia | Execução | Desfazer |
|---|---|---|---|---|---|
| `propose_send_messages` | `message.send` | `contact_ids ≤ 200` ou `filter` (de `list_conversations`/`list_events`, ex.: "avaliação amanhã"), `content` (texto com variáveis `{primeiro_nome}`, `{hora}`, `{procedimento}` de uma allowlist, ou `template_id` + variáveis) | **o texto final renderizado de 3 destinatários reais** + a contagem; política | um item por destinatário via `enqueueMemberMessage`; consentimento reconferido no item | só se agendado e ainda não despachado: cancela |
| `propose_campaign_status` | `campaign.pause` \| `campaign.resume` \| `campaign.cancel` | `campaign_id`, `action` | status atual → novo; enviadas, agendadas, custo; para `cancel`, `alternative: 'pause'` no DTO | `lifecycle.ts` | `pause` ↔ `resume`; `cancel`: nenhum |
| `propose_trigger_flow` | `flow.trigger` | `flow_id` (publicado), `contact_ids ≤ 200` | flow, contatos, "o flow pode enviar mensagens" se tiver nó de envio | o disparo existente do flow-engine (`routes/flows/engine.ts`, por import) | cancela as execuções ainda pendentes (`cancelFlowExecution`) |

- Variáveis de mensagem: renderização num só lugar (`act-external/render.ts`) com escape e allowlist. Variável sem valor para um destinatário → item `skipped_policy` ("sem horário de avaliação").
- O texto proposto pelo modelo é **dado**: a prévia mostra exatamente o que sai, e quem confirma é a pessoa. O modelo não escolhe destinatários fora do que a ferramenta resolveu sob o escopo.
- Permissão por volume: 1 destinatário → `conversation.assign` + visibilidade da conversa; 2 ou mais → `campaign.edit` (a função do catálogo do S02).

## Fora de escopo

- Consertar `DELETE /api/campaigns/:id` (slot de segurança separado, já mapeado).
- Saldo e cobrança de mensagens. Criar campanha nova pelo Copiloto (v1.1).

### files_allowed

- `apps/api/src/internal/copilot/act-external/**`
- `apps/api/src/services/campaigns/**`
- `apps/api/src/services/messaging/**`
- `apps/api/src/routes/campaigns/lifecycle.ts`
- `apps/api/src/routes/conversations/messages.ts`

### files_forbidden

- `apps/api/src/routes/campaigns/crud.ts`
- `apps/workers/**`
- `packages/**`

## Definition of Done

- [ ] Todas as propostas desta slot classificadas nível 4 (teste)
- [ ] Política: teste por linha (fora da janela; sem consentimento → pulado; conversa fechada há mais de 24 h com texto livre → `block`; com modelo aprovado → ok); recalculada no confirmar (consentimento revogado entre propor e confirmar → item pulado)
- [ ] Mensagem enviada aparece no outbox com `actor` do membro e `metadata.via='copilot'`; o consent gate do worker continua sendo a última barreira (teste de integração do enqueue)
- [ ] `cancelCampaign` recusa sem `campaign.cancel`, recusa status `completed|cancelled` e informa os números; `pause`/`resume` mantêm o comportamento da rota (testes existentes verdes)
- [ ] Prévia de `send_messages` mostra 3 textos renderizados reais e nunca dados de um destinatário na mensagem de outro (teste com 2 contatos de nomes diferentes)
- [ ] Testes existentes de `routes/campaigns` e `routes/conversations/messages*` verdes sem edição

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/internal/copilot/act-external src/services/campaigns src/services/messaging src/routes/campaigns src/routes/conversations --maxWorkers=1
```

## Notas

- Agente: `backend-engineer` (opus). `/hm-security` no fim do slot, registrado no F73-S14.
- A caixa "Revisei" é `acknowledged: true` no `confirm` (motor S05). Sem ela, 422.
- "Pausar em vez disso" é a interface chamando `adjust` com `params.action='pause'`; o executor declara `action` como ajustável.
