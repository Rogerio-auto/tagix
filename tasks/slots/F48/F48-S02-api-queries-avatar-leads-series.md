---
id: F48-S02
title: Queries — avatar no ranking, leads recentes, série 30d
phase: F48
status: blocked
priority: high
estimated_size: M
depends_on: [F48-S01]
blocks: [F48-S03]
agent_id: backend-engineer
source_docs:
  - docs/features/DASHBOARD.md
---

# F48-S02 — Queries de dados do Command Center v2

## Objetivo

Adicionar em `dashboard/queries.ts` as três fontes de dado novas: (1) leaderboard de produtividade
**com avatar** dos atendentes, (2) leads recentes por **atividade recente** com avatar, (3) série
diária de 30d lida da MV `mv_dashboard_daily_30d`. Enriquecer também os rankings existentes baseados
em member com `avatar_url`.

## Contexto

`members.avatar_url` e `contacts.avatar_url` já existem; as queries de ranking trazem `memberId`/nome
mas não a foto. Este slot só produz os valores (jsonb-like); o registro como métrica/card e o wiring
ficam no S03. Todas as queries rodam sob a tx com RLS (`req.scoped`); leitura de MV filtra
`workspace_id` explícito (MV não tem RLS).

## Escopo (faz)

- `leaderboardProdutividade(tx, workspaceId)` → `{ rows: [{ memberId, nome, avatarUrl, resolvidas,
  abertas, tmr_seg }] }`, ordenado por `resolvidas` desc, depois `tmr_seg` asc. Reusar a lógica de
  `performancePorAtendente` (FRT lateral) + `JOIN members` trazendo `m.avatar_url`.
- `leadsRecentes(tx, limit = 8)` → `{ rows: [{ contactId, nome, avatarUrl, canal, lastActivityAt,
  preview }] }`. Critério **atividade recente**: contatos via suas conversas, ordenados por
  `conversations.last_message_at` desc (distinct por contato, pega a conversa mais recente). Trazer
  `contacts.avatar_url`, `contacts.name`, provider do canal e o preview da última mensagem.
- `serieDesempenho30d(tx, workspaceId)` → `{ series: [{ day, resolvidas, conversoes,
  conversoes_valor_cents, novos_contatos }] }` lendo `mv_dashboard_daily_30d` com
  `WHERE workspace_id = ${workspaceId} ORDER BY day ASC`.
- Enriquecer `conversoesPorAtendenteHumano` e `qualidadePorAtendente` para incluir `avatarUrl` nas
  rows (join member já existe; só adicionar `members.avatarUrl` ao select e à row). **Não** alterar
  as `columns` (compatível com o TableCard atual) — `avatarUrl` é campo extra ignorado por ele.

## Fora de escopo

- Registrar como métrica/definição ou no `load-dashboard` (S03). Frontend (S04–S08).
- Alterar a forma das `columns` das tabelas existentes (só acrescentar `avatarUrl` nas rows).

## Arquivos permitidos

- `apps/api/src/services/dashboard/queries.ts`
- `apps/api/src/services/dashboard/queries.test.ts` (novo, se criar testes de shape)

## Arquivos proibidos

- `apps/api/src/services/dashboard/definitions.ts` (S03), `load-dashboard.ts` (S03)
- `packages/db/**` (S01)

## Contratos de saída

- Leaderboard row: `{ memberId, nome, avatarUrl: string|null, resolvidas:int, abertas:int, tmr_seg:int|null }`.
- Lead row: `{ contactId, nome, avatarUrl: string|null, canal:string, lastActivityAt:string(ISO), preview:string|null }`.
- Série: `{ series: [{ day:string(ISO date), resolvidas:int, conversoes:int, conversoes_valor_cents:int, novos_contatos:int }] }`.

## Definition of Done

- [ ] As 3 funções novas existem, tipadas, sem `any` (jsonb-like `Record<string, unknown>` ou tipo próprio).
- [ ] `leadsRecentes` é distinct por contato (uma linha por contato, a atividade mais recente).
- [ ] Rankings member-based passam a expor `avatarUrl` nas rows sem mudar `columns`.
- [ ] Leitura de MV filtra `workspace_id` explícito.
- [ ] `pnpm typecheck` + `pnpm lint` verdes; testes de shape (se criados) passam.

## Permission scope

- Sem decisão de role aqui (é só dado). A visibilidade por role é decidida no S03 via `definitions.ts`.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- `last_message_at` é o mesmo campo usado pela ChatList (`ConversationSummary.lastMessageAt`).
- Para distinct-por-contato, usar `DISTINCT ON (contact_id) ... ORDER BY contact_id, last_message_at DESC`
  num subselect e reordenar por `last_message_at DESC` no outer.
- `avatarUrl` pode ser `null` — o front cai no fallback de iniciais (S04 `<Avatar>`).
