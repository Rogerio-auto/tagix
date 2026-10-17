---
id: F73-S05
title: Motor de propostas (classificar, prever, confirmar, executar item a item, parar, desfazer, aprovação) e API de propostas e atividade
phase: F73
status: review
priority: critical
estimated_size: L
model: opus
ui: false
depends_on: [F73-S01, F73-S02, F73-S03]
blocks: [F73-S08, F73-S09, F73-S11, F73-S12, F73-S13, F73-S14, F74-S12]
source_docs:
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
agent_id: backend-engineer
claimed_at: 2026-10-17T05:21:24Z
completed_at: 2026-10-17T06:35:02Z

---
# F73-S05 — Motor de propostas

## Objetivo

Implementar o ADR-004: um motor genérico, independente de qualquer capacidade, que transforma um pedido de escrita em proposta classificada, prévia, confirmação humana idempotente, execução determinística item a item com conflito por versão, Parar, Desfazer dentro da janela e pedido de aprovação a um gestor. Inclui a API pública de propostas e a Atividade (A8).

## Contexto

As capacidades concretas (mover negócios, tags, mensagens…) registram **executores** nas F73-S08 e S09, e o piloto automático (S13) usa o mesmo motor com `source='autopilot'`. Aqui os executores de teste são fakes, para provar o motor sem domínio.

## Escopo (faz)

- `apps/api/src/internal/copilot/core/executor-types.ts`: substituir o placeholder do S03 pelo tipo real:
  ```ts
  interface CapabilityExecutor<Args> {
    capability: CapabilityKey;
    resolveTargets(ctx, args): Promise<{ targets: Target[]; dropped: { id: string; reason: 'not_found' }[] }>;
    preview(ctx, args, targets): Promise<{ items: PreviewItem[]; impact: ProposalImpact; external: boolean;
                                           irreversible: boolean; notifiesMembers: boolean; summary: string }>;
    policyCheck?(ctx, args, targets): Promise<PolicyCheck[]>;
    executeItem(ctx, args, item): Promise<{ status: 'done'|'skipped_conflict'|'skipped_policy'|'failed';
                                            after?: Json; undoPayload?: Json; errorCode?: string; conflictBy?: string }>;
    undoItem?(ctx, item): Promise<{ status: 'undone'|'undo_conflict'|'failed'; errorCode?: string }>;
  }
  ```
- `apps/api/src/services/copilot/proposals/**`:
  - `propose.ts`: `proposeAction(ctx, capability, args)` com o algoritmo do ADR-004 §1 (resolver → versão → classificar → autorizar → prévia → política → nível 2 executa na hora; 3 e 4 persistem `proposed` com TTL de 15 ou 10 min). Ferramentas de escrita usam `makeProposeTool(executor, argsSchema)`, que gera o `CopilotToolDefinition` `propose_<capability>`. A resposta ao modelo é curta: `awaiting_confirmation` + resumo, ou o recibo, ou o bloqueio com motivo;
  - `confirm.ts`: `confirmProposal(principal, id, { idempotencyKey, version, acknowledged, adjustments })` com a revalidação completa e o CAS do ADR-004 §2 (mesma chave = mesmo resultado; outra chave = 409 `already_confirmed`; versão divergente = 409 `stale_proposal`; expirada = 410 `proposal_expired`; nível 4 sem `acknowledged` = 422);
  - `adjust.ts`: excluir itens e trocar parâmetros declarados ajustáveis pelo executor; recalcula risco, prévia e política; `version++`;
  - `execute.ts`: laço item a item, cada item em transação própria (`withWorkspace`), renovando o lease a cada item, conferindo `stop_requested` entre itens, emitindo `copilot:proposal_updated` (throttle de 250 ms) e fechando em `completed`/`partially_completed`/`failed` com `undo_deadline` (nível 2 e 3: 24 h; `autopilot`: 7 dias; nível 4: `null`, salvo se o executor declarar desfazer, como envio agendado);
  - `cancel.ts`: antes de executar → `cancelled`; durante → `stop_requested`;
  - `undo.ts`: idempotente por chave, item a item em ordem inversa, conferindo o estado atual contra `after`; resultado `undone` ou `partially_undone`;
  - `retry.ts`: cria uma proposta nova só com os itens `failed`/`skipped_conflict`, com resolução e versão novas;
  - `approval.ts`: `requestApproval(principal, id, approverMemberId)` para proposta `blocked` por `role`.
    - O aprovador precisa ter a permissão da capacidade (calculada no servidor). `listApprovers(capability)` devolve só membros ativos com essa permissão: `{ member_id, name, role }`.
    - Status `awaiting_approval`, TTL de 72 h, notificação `copilot_aprovacao` ao aprovador e, na decisão, ao solicitante (cascata existente).
    - Confirmar como aprovador usa as permissões **do aprovador**.
  - `sweeper.ts`: a cada 60 s, com lock Redis (`acquireSchedulerLock`, com chave própria), expira `proposed`/`awaiting_approval` vencidas e retoma `executing` com lease vencido;
  - `audit.ts`: uma linha em `audit_logs` por transição (`actor_type` `copilot` ou `autopilot`, `actor_member_id` = permissões usadas, `requested_by_member_id`, `copilot_proposal_id`, `copilot_turn_id`, `metadata { capability, risk_level, from, to, counts }`, sem PII);
  - `dto.ts`: `toProposalDTO(row, items, viewer)` calcula `can_confirm`/`can_undo` para quem lê.
- Início do sweeper em `apps/api/src/server.ts`: só no processo HTTP, com `unref`, parado no shutdown.
- Rotas `apps/api/src/routes/copilot/proposals/**` e `apps/api/src/routes/copilot/activity/**` (spec §5.2):
  - `GET /api/copilot/proposals/:id`;
  - `confirm`, `adjust`, `cancel`, `undo`, `retry-failed` e `request-approval`;
  - `GET /api/copilot/approvers`;
  - `GET /api/copilot/activity?scope=mine|all&cursor=`: linhas legíveis com quem pediu, o que mudou, resultado e Desfazer, incluindo `blocked` com encaminhamento;
  - `GET /api/copilot/activity.csv` (`copilot.activity.view_all`; streaming CSV, sem PII além de nomes de membros e títulos de negócio).
  Todas com `copilotAvailable` (S03). A escrita passa pelo guard de assinatura **sem** exceção: `confirm` em só leitura dá 402.
- Rate limit: `confirm`, `undo` e `adjust` limitados a 30/min por membro (middleware existente `rate-limit.ts`, por import).

## Fora de escopo

- Executores reais (S08, S09). Piloto automático (S13). Interface (F74-S04 e F74-S07).

### files_allowed

- `apps/api/src/internal/copilot/core/executor-types.ts`
- `apps/api/src/services/copilot/proposals/**`
- `apps/api/src/routes/copilot/proposals/**`
- `apps/api/src/routes/copilot/activity/**`
- `apps/api/src/server.ts`

### files_forbidden

- `apps/api/src/internal/copilot/act-crm/**`
- `apps/api/src/internal/copilot/act-external/**`
- `packages/**`

## Contratos

- `ProposalDTO`, `ActivityEntry`, `ConfirmProposalBody`, `AdjustProposalBody` e `RequestApprovalBody` vêm de `@hm/shared/copilot` (S02).
- Códigos HTTP: 200 (estado atual), 202 (confirm aceito, executando), 402 (só leitura), 403 (sem permissão), 404 (não existe ou não é visível; sem oráculo), 409 (`already_confirmed`, `stale_proposal`, `not_undoable`), 410 (`proposal_expired`, `undo_window_closed`), 422 (`ack_required`, `invalid_adjustment`).

## Definition of Done

- [ ] Testes do motor com executores fake (unit + integração no banco de dev):
  - nível 2 executa na hora e desfaz;
  - nível 3 e 4 persistem e expiram;
  - confirmar duas vezes em paralelo → uma execução;
  - mesma chave → mesmo resultado;
  - chave diferente → 409;
  - versão divergente → 409;
  - nível 4 sem ack → 422;
  - papel rebaixado entre propor e confirmar → 403;
  - assinatura expirada no confirmar → 402;
  - conflito por versão em 2 de 7 itens → `partially_completed` com motivo;
  - Parar no meio → `partially_completed`;
  - lease vencido retomado pelo sweeper sem duplicar item;
  - desfazer com um item alterado depois → `partially_undone`;
  - desfazer depois da janela → 410;
  - retry cria proposta nova;
  - aprovação: só aprovador elegível, executa com as permissões dele, trilha com `requested_by`;
  - turno contaminado eleva o nível 2 para 3
- [ ] `audit_logs` gravado em toda transição (teste conta as linhas)
- [ ] `activity` paginada por cursor, `scope=all` exige `copilot.activity.view_all`, e o CSV não carrega telefone nem e-mail
- [ ] Sem `any`; erros com códigos estáveis

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/copilot/proposals src/routes/copilot/proposals src/routes/copilot/activity --maxWorkers=1
```

## Notas

- Agente: `backend-engineer` (opus). É o coração da segurança operacional: revisão `/hm-engineer` obrigatória antes do merge.
- "Movi 5 de 7. Parei em dois que a Paula estava editando": o executor devolve `conflictBy` (nome do membro do último `deal_history`) e o motor guarda em `error_code: 'conflict'` + `after: { conflict_by }`.
- O throttle de eventos de progresso evita inundar o socket num lote de 200.
