---
id: F73-S08
title: Ações de CRM do Copiloto (tags, contato, responsável, mover negócios, nota, compromisso interno) com prévia e desfazer
phase: F73
status: blocked
priority: high
estimated_size: L
model: opus
ui: false
depends_on: [F73-S05, F73-S06]
blocks: [F73-S13, F73-S14, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
  - docs/features/PIPELINE.md
  - docs/design/copilot-integracoes-ux.md
agent_id: backend-engineer
---
# F73-S08 — Ações de CRM

## Objetivo

O Copiloto consegue, em nome do membro e com prévia proporcional, adicionar e remover tags, editar um contato, trocar o responsável, mover negócios de estágio (o fluxo da A4, "mover parados há 7 dias para Reativação"), escrever nota interna e criar compromisso interno. Cada ação tem desfazer real. As regras de domínio vêm dos **mesmos** services que as telas usam.

## Contexto

O motor (F73-S05) já classifica, confirma, executa item a item e desfaz. Aqui entram os `CapabilityExecutor` concretos e as ferramentas `propose_*` correspondentes. Em parte do domínio a regra ainda vive na rota (contatos, tags, notas, responsável): o mínimo é extraído para service, sem mudar o comportamento da rota (spec §11.8).

## Escopo (faz)

- Extrair para service, com a rota passando a delegar e os testes existentes da rota verdes **sem alteração**:
  - `apps/api/src/services/contacts/tags.ts`: `addTags` e `removeTags` (de `routes/contacts/contacts.ts` e `routes/tags.ts`);
  - `apps/api/src/services/contacts/update.ts`: `updateContactFields`, com a allowlist `UPDATE_CONTACT_EDITABLE_FIELDS` de `internal/tools/contact-handlers.ts`, por import;
  - `apps/api/src/services/deals/owner.ts`: `assignDealOwner` (de `routes/deals/crud.ts`), registrando `deal_history` `owner_changed`;
  - `apps/api/src/services/conversation-notes/create.ts`: `createNote` e `deleteNote` (de `routes/conversations/notes.ts`).
- `apps/api/src/services/deal-move.ts` e `apps/api/src/services/deal-hooks.ts`: opção retrocompatível `origin?: 'undo'` em `StageChangeEvent`/`moveDealToStage`.
  - Com `origin: 'undo'`, `validateTransition` ignora `allowedFromStageIds` (voltar para onde estava é restaurar estado, não transição de negócio); `requiredRoles` e `requiresApproval` continuam valendo.
  - Com `origin: 'undo'`, o hook **não agenda** automações `on_enter`/`on_exit` e **cancela** as `pending_automations` ainda `pending` criadas pela movimentação desfeita (correlação por `deal_id` + `metadata.proposal_id`).
  - Teste de não regressão do caminho normal.
- Executores e ferramentas em `apps/api/src/internal/copilot/act-crm/**`, registrados no stub `act-crm/index.ts` (`tools` + `executors`):

| Ferramenta | Capacidade | Alvos | Prévia (`before → after`) | Desfazer |
|---|---|---|---|---|
| `propose_tag_contacts` | `contact.tag` | `contact_ids ≤ 200` ou `filter` (o mesmo de `search_contacts`), `tag`, `op` | tags antes e depois | restaura o conjunto anterior |
| `propose_update_contact` | `contact.update` | 1 contato, `fields` (allowlist) | campo a campo | restaura os campos se o valor atual = `after` |
| `propose_assign_deals` | `deal.assign_owner` | `deal_ids ≤ 200` ou `filter` (o de `list_deals`), `owner_id` | responsável antes e depois; quem é avisado | restaura o responsável |
| `propose_move_deals` | `deal.move` | `deal_ids ≤ 200` ou `filter`, `to_stage_id`, `notify_owners: boolean` (ajustável) | estágio antes e depois; impacto em R$ na previsão (com a mesma `p(estágio)` do `forecast_revenue`); critério em texto ("cliente sem responder há 7 dias ou mais") | volta ao estágio de origem (`origin: 'undo'`) |
| `propose_add_note` | `conversation.note` | 1 conversa visível, `body ≤ 2000` | a nota | apaga a nota |
| `propose_create_event` | `event.create_internal` | `calendar_id`, `title`, `starts_at`, `ends_at`, `contact_id?`, `deal_id?`, **sem aviso ao cliente** | o compromisso | cancela (`cancelEvent`) |

- **Automação de estágio é efeito externo** (`act-crm/stage-effects.ts`). Ao prever um `propose_move_deals`, ler `automation_rules` do estágio de destino (`on_enter`) e do de origem (`on_exit`):
  - `send_message`, `trigger_flow` ou `register_conversion` → `external = true`, ou seja, **nível 4**, e a prévia lista "Ao entrar em Reativação, a automação 'X' envia mensagem ao cliente";
  - `notify_members` → `notifies_members = true`, ou seja, nível ≥ 3;
  - `transition_rules.requiresApproval` → o item fica `skipped_policy` ("este estágio exige aprovação no Pipeline").
- **Conflito por versão** em todo executor: `expected_version` = `updated_at` (+ `stage_id`/`owner_id` quando aplicável). Se divergir, o resultado é `skipped_conflict` com `conflictBy` (nome do último ator em `deal_history` ou `audit_logs`).
- Escopo de alvos: os mesmos de S06 e S07. AGENT só move ou atribui negócios que vê, e o `requiredRoles` do estágio continua valendo.
- `actor = { type: 'member', memberId: executed_as }` e `metadata: { via: 'copilot' | 'autopilot', proposal_id }` em tudo o que os services gravam.
- Avisar responsáveis (`notify_owners`): nota interna mencionando o responsável (o mecanismo `note:mentioned` existente) com o texto "Movido pelo Copiloto a pedido de <nome>", sem mensagem ao cliente.

## Fora de escopo

- Mensagens a clientes, campanhas e flows (S09). Lembrar fato (S11). Criar ou alterar automações (v1.1).

### files_allowed

- `apps/api/src/internal/copilot/act-crm/**`
- `apps/api/src/services/contacts/**`
- `apps/api/src/services/deals/**`
- `apps/api/src/services/conversation-notes/**`
- `apps/api/src/services/deal-move.ts`
- `apps/api/src/services/deal-hooks.ts`
- `apps/api/src/services/deal-move.test.ts`
- `apps/api/src/routes/contacts/contacts.ts`
- `apps/api/src/routes/tags.ts`
- `apps/api/src/routes/deals/crud.ts`
- `apps/api/src/routes/conversations/notes.ts`

### files_forbidden

- `apps/api/src/internal/tools/**` (caminho de agente; só importar)
- `apps/api/src/services/copilot/proposals/**` (motor; só importar)

## Definition of Done

- [ ] Cada executor com teste de integração cobrindo: prévia; execução; conflito por versão; desfazer; desfazer com conflito; escopo de AGENT; cross-tenant
- [ ] `propose_move_deals` vira nível 4 quando o destino tem `send_message` ou `trigger_flow` em `on_enter`, com a linha na prévia (teste); `notify_members` dá ≥ 3; `requiresApproval` dá `skipped_policy`
- [ ] Desfazer movimentação não agenda automação e cancela as pendentes da movimentação original (teste lendo `pending_automations`)
- [ ] O fluxo da A4 de ponta a ponta no banco de dev: 7 negócios, 2 alterados por outro membro entre propor e confirmar, resultado "5 de 7" com os nomes, desfazer dos 5
- [ ] Testes existentes de `routes/contacts`, `routes/deals`, `routes/conversations` (notes), `routes/tags` e `services/deal-move` verdes **sem edição**, salvo a adição de casos novos
- [ ] `deal:stage_changed` emitido para cada item movido (é o que anima o quadro na F74)

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/internal/copilot/act-crm src/services/contacts src/services/deals src/services/conversation-notes src/services/deal-move.test.ts src/routes/contacts src/routes/deals src/routes/tags src/routes/conversations --maxWorkers=1
```

## Notas

- Agente: `backend-engineer` (opus: mexe em services centrais e na régua de risco).
- A descoberta "automação de estágio torna a movimentação externa" não está na maquete: está registrada na spec §6.2. Se alguma automação real em produção mudar o nível de pedidos comuns, registre na nota de execução com números.
