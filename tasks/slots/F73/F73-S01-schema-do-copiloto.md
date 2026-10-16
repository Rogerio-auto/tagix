---
id: F73-S01
title: Schema do Copiloto (sessões, turnos, propostas, memória, briefing, piloto) com RLS e repos
phase: F73
status: in-progress
priority: critical
estimated_size: L
model: opus
ui: false
depends_on: []
blocks: [F73-S03, F73-S05, F73-S10, F73-S11, F73-S12, F73-S13, F73-S15]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-003-identidade-do-membro-nas-acoes-de-ia.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
  - docs/DATA_MODEL.md
agent_id: db-engineer
claimed_at: 2026-10-16T23:27:39Z

---
# F73-S01 — Schema do Copiloto

## Objetivo

O banco passa a representar tudo o que o Copiloto precisa: configuração e preferências, sessões e mensagens, turnos (a credencial das ferramentas), propostas de ação com itens e desfazer, memória do negócio com fonte, briefing do dia e piloto automático. Também estende `audit_logs` e `llm_usage_logs`. Tudo com RLS, FKs compostas por workspace e repos tipados.

## Contexto

É o slot de schema **único** da F73 e da F74: nenhum outro slot das duas fases toca `packages/db/src/schema/**` nem `packages/db/drizzle/**`. A F75 (integrações, outro trabalho) tem o seu `F75-S01` dependendo deste. Spec: `docs/features/COPILOTO.md` §4 (tabela por tabela, com colunas, checks e índices).

## Escopo (faz)

- `packages/db/src/schema/copilot.ts` com as 12 tabelas do §4 da spec: `copilot_settings`, `copilot_member_prefs`, `copilot_sessions`, `copilot_messages`, `copilot_turns`, `copilot_tool_calls`, `copilot_action_proposals`, `copilot_action_items`, `copilot_memory_entries`, `copilot_briefings`, `copilot_autopilot_rules`, `copilot_suggestions`.
  - Todo enum de texto com `check` (padrão do repo, ex.: `audit_logs_actor_type_chk`).
  - `copilot_action_proposals.risk_level smallint check (risk_level between 1 and 4)`.
  - `copilot_memory_entries.content` com `check (length(btrim(content)) between 1 and 500)` e `embedding` como `vector(1536)` nullable, usando o tipo custom de `schema/knowledge.ts`.
  - Únicos parciais do §4: perfil ativo por chave; sugestão pendente por negócio; turno por `client_request_id`; briefing por (membro, data).
- Extensões no mesmo arquivo de migração:
  - `audit_logs`: `requested_by_member_id uuid null` (FK `members`, `on delete set null`), `copilot_proposal_id uuid null`, `copilot_turn_id uuid null`; recriar `audit_logs_actor_type_chk` aceitando `copilot` e `autopilot`; índice parcial (`workspace_id`, `copilot_proposal_id`) where not null.
  - `llm_usage_logs`: `surface text not null default 'agent'` com check (`agent`\|`copilot`), `copilot_turn_id uuid null`; índice (`workspace_id`, `surface`, `created_at desc`).
- RLS por `workspace_id` em todas as tabelas novas (padrão `packages/db/src/rls.ts`) e FKs compostas `(workspace_id, x_id)` para `members`, `stages`, `deals` e as próprias tabelas do Copiloto (padrão F70-S12 e `tenant-refs.ts`).
- Migração na **próxima livre** (conferir `drizzle/meta/_journal.json`; hoje a última é a 0096), idempotente onde fizer sentido (`if not exists` nos índices) e com `down` documentado no cabeçalho do SQL.
- Repos em `packages/db/src/repos/copilot/**`, exportados por `@hm/db`:
  - `copilotSettingsRepo`: `get(tx, ws)` com os defaults do §4 quando não há linha; `upsert`.
  - `copilotMemberPrefsRepo`: `get`, `upsert`.
  - `copilotSessionsRepo`: `create`, `listByMember(cursor, limit ≤ 50)`, `getOwned(id, memberId)`, `rename`, `archive`, `touch`.
  - `copilotMessagesRepo`: `append`, `listBySession(cursor)`, `lastForPrompt(sessionId, n ≤ 12)`.
  - `copilotTurnsRepo`: `createRunning`, `claimToolCall(turnId, memberId, nonce)`, `markTainted`, `complete(usage)`, `fail(code)`, `findRunningByMember`.
    - `claimToolCall` é um `UPDATE … SET tool_calls = tool_calls + 1 WHERE id=$1 AND member_id=$2 AND grant_nonce=$3 AND status='running' AND expires_at > clock_timestamp() AND tool_calls < max_tool_calls RETURNING …`; devolve `null` se não casar.
  - `copilotToolCallsRepo`: `insert`.
  - `copilotProposalsRepo`:
    - `insertWithItems`, `getWithItems`;
    - `transition(id, fromStatuses[], toStatus, expectedVersion, patch)` por CAS, devolvendo a linha ou `null`;
    - `setItemStatus`, `renewLease`, `listExpiredOpen(now, limit)`, `listStaleExecuting(now, limit)`, `listActivity({ scope: 'mine'|'all', memberId, cursor, limit ≤ 50 })`.
  - `copilotMemoryRepo`: `listActiveForPrompt(ws)` (perfil completo + até 30 fatos ativos e ≤ 2.500 caracteres no total, com os de pessoa antes dos do Copiloto e das integrações, e por recência; cada fato devolve `source_type`), `listFacts(cursor)`, `upsertProfile` (o antigo vira `superseded`), `addFact`, `forget`, `restore`, `correct` (o original vira `superseded` e o novo leva `source_type='member'`).
  - `copilotBriefingsRepo`: `getFor(memberId, date)`, `upsert`, `markSeen`, `markPushSent`.
  - `copilotAutopilotRepo`: `listRules`, `upsertRule`, `insertSuggestionIfAbsent`, `listSuggestions(status, cursor)`, `decideSuggestions(ids, decision, memberId)`, `expireSuggestionsForDeal`.
- `packages/db/src/repos/copilot/idle.ts`: `dealIdleDaysSql()`, o fragmento SQL que dá os dias desde a última mensagem **do contato** na conversa vinculada ao negócio (ou desde `deals.updated_at`, se não houver conversa), e `dealLastMessageDirectionSql()` (`inbound`\|`outbound`\|`null`). É a régua única de "parado" usada pelas consultas (S06), pelo briefing (S12) e pelo piloto (S13). Teste com conversa sem mensagem, só mensagem nossa e mensagem do contato.
- Stubs de módulo para os slots seguintes, para que o `index.ts` não precise ser editado de novo:
  - `packages/db/src/copilot/index.ts` reexportando `./autopilot`;
  - `packages/db/src/copilot/autopilot/index.ts` com `export {}` e um comentário apontando o slot dono (S13, gerador de sugestões que roda no worker).
- Testes:
  - RLS de cada tabela nova em `rls.test.ts`: isolamento entre dois workspaces, leitura e escrita;
  - FKs compostas (referência a membro, estágio ou negócio de outro workspace é recusada);
  - `claimToolCall` concorrente (20 chamadas paralelas com `max=16` → exatamente 16 sucessos);
  - CAS de `transition` (duas chamadas paralelas → uma vence);
  - únicos parciais;
  - `audit_logs` aceita `copilot`/`autopilot` e continua recusando valor desconhecido;
  - `llm_usage_logs.surface` default `agent`.

## Fora de escopo

- Qualquer rota, service ou worker (S03 em diante).
- Lógica de briefing (S12, na API) e de sugestão (S13 preenche o stub de `packages/db/src/copilot/autopilot`).
- Mudar `monthToDateSpendUsd` para filtrar `surface` (F73-S10, em `packages/agents-core`).

### files_allowed

- `packages/db/src/schema/copilot.ts`
- `packages/db/src/schema/copilot.test.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/llm.ts`
- `packages/db/drizzle/**`
- `packages/db/src/repos/copilot/**`
- `packages/db/src/repos/index.ts`
- `packages/db/src/copilot/index.ts`
- `packages/db/src/copilot/autopilot/index.ts`
- `packages/db/src/index.ts`
- `packages/db/src/rls.test.ts`
- `packages/db/src/workspace-composite-fks.test.ts`
- `packages/db/src/tenant-refs.ts`
- `packages/db/src/tenant-refs.test.ts`

### files_forbidden

- `apps/**`
- `packages/shared/**`

## Contratos

- Tipos exportados: `CopilotSettingsRow`, `CopilotProposalRow`, `CopilotActionItemRow` e os demais `$inferSelect`/`$inferInsert`. Os enums de status saem como `as const` (ex.: `COPILOT_PROPOSAL_STATUSES`) para o `@hm/shared` (S02) espelhar em Zod. Um teste no S02 confere a igualdade.
- Defaults de `copilotSettingsRepo.get` sem linha: `{ enabled: true, capabilityMatrix: {}, monthlyBudgetUsd: '30.00', budgetMode: 'queries_only', budgetAlertPct: 80, historyRetentionMonths: 12, defaultAutoOpen: 'daily', partnerAccess: false, model: null }`.

## Definition of Done

- [ ] As 12 tabelas criadas com checks, índices e únicos parciais do §4 da spec
- [ ] RLS em todas, com teste de isolamento entre dois workspaces (leitura e escrita)
- [ ] FKs compostas por workspace testadas
- [ ] `audit_logs` e `llm_usage_logs` estendidos sem quebrar consumidores (`@hm/api`, `@hm/workers` e `@hm/agents-core` com typecheck verde)
- [ ] Repos exportados por `@hm/db`, com teste de concorrência de `claimToolCall` e de `transition`
- [ ] `python scripts/slot.py check-migrations` verde; a migração aplica num banco limpo e no banco de dev
- [ ] Nota de execução com o número real da migração e o `EXPLAIN` das 3 queries quentes: `listActivity`, `listBySession` e `claimToolCall`

## Validação

```bash
python scripts/slot.py check-migrations
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/agents-core typecheck
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/rls.test.ts src/schema/copilot.test.ts src/workspace-composite-fks.test.ts --maxWorkers=1
```

## Notas

- Agente: `db-engineer`. Paralelo ao F73-S02 e ao F73-S04, sem arquivo em comum.
- `copilot_sessions` e `copilot_messages` são privados do membro, e quem filtra por `member_id` é o service (ADR-003 §5). O RLS só garante o workspace. Não criar policy por membro: o padrão do repo é GUC de workspace.
- Coluna de dinheiro: `numeric` como string no Drizzle (padrão do repo). Não usar `real`.
- Não alterar o check de `deal_history.actor_type`: a origem "copiloto" vai em `metadata.via` (spec §4).
