---
id: F55-S01
title: Timestamps de ciclo em conversations (first_response_at/resolved_at/closed_at) + backfill
phase: F55
status: done
priority: critical
estimated_size: S
depends_on: []
blocks: [F55-S02, F55-S03, F55-S04]
agent_id: db-engineer
source_docs:
  - docs/features/DASHBOARD.md
completed_at: 2026-06-29T22:21:57Z

---
# F55-S01 — Timestamps de ciclo em conversations + backfill

## Objetivo

Adicionar à tabela `conversations` os três timestamps de ciclo de vida que hoje **não existem** —
`first_response_at`, `resolved_at`, `closed_at` — e fazer backfill best-effort do histórico. Isso é a
fundação para SLA/TTR/TMR **exatos** (hoje recomputados sobre `messages`, caro e impreciso) e para a MV
de 30 dias parar de usar `updated_at` como proxy de "resolvido".

## Contexto

O `DASHBOARD.md §2.1` já especificava `tempo_medio_resolucao_24h` como `closed_at − opened_at` — o spec
sempre assumiu esses timestamps; eles nunca foram materializados. Sem eles, toda métrica de resolução
depende de `updated_at` (muda em qualquer update) ou de varrer `messages`. Este slot só cria as colunas +
backfill; **popular nos write paths é o S02** e **recriar a MV é o S03**.

## Escopo

### files_allowed
- `packages/db/src/schema/conversations.ts` (3 colunas nullable `timestamptz`)
- `packages/db/drizzle/0059_f55_conversation_cycle_ts.sql` (NOVO — ALTER TABLE + índices + backfill)
- `packages/db/drizzle/meta/**` (journal/snapshot gerados pelo drizzle-kit)

### files_forbidden
- `apps/**` (write paths são S02), qualquer outra tabela em `packages/db/src/schema/*`

## Escopo (faz)
- Schema: `firstResponseAt`, `resolvedAt`, `closedAt` — todos `timestamptz` nullable (NULL = ainda não
  ocorreu). Sem default.
- Migration: `ALTER TABLE conversations ADD COLUMN ...` x3. Índice parcial em `resolved_at`
  (`WHERE resolved_at IS NOT NULL`) para a MV/queries de série; índice em `first_response_at` se barato.
- **Backfill best-effort** (no mesmo arquivo de migration, idempotente):
  - `first_response_at` = `MIN(messages.created_at)` da 1ª mensagem `direction='outbound' AND sender_type='member'` por conversa.
  - `resolved_at`/`closed_at` = `MAX(messages.created_at)` (proxy) **apenas** para conversas já em
    `status IN ('resolved','closed')` e cujo timestamp ainda é NULL. Documentar no SQL que para dados
    antigos é aproximação; dados novos (S02) serão exatos.
- RLS: colunas herdam a policy existente da tabela `conversations` — **não** criar policy nova
  (a tabela já é RLS-protegida; ALTER COLUMN não muda isso). Confirmar que a migration roda como owner.

## Fora de escopo
- Popular as colunas em runtime (S02). Recriar a MV (S03). Qualquer query de dashboard (S04).

## Contratos de saída
- `conversations.first_response_at | resolved_at | closed_at : timestamptz | null` disponíveis para S02/S03/S04.

## Definition of Done
- [ ] 3 colunas no schema Drizzle + migration aplicável em DB dev (Docker) sem erro.
- [ ] Backfill roda e popula linhas históricas plausíveis (spot-check: conversa fechada tem `closed_at`).
- [ ] Migration idempotente (rodar 2x não duplica/erra) — usar `IF NOT EXISTS` nos ADD COLUMN.
- [ ] `pnpm typecheck` e `pnpm lint` verdes.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
Próximo de 0058 (`pending_plan_key`). Confirmar o número livre real antes de nomear o arquivo. Gerar a
migration com a ferramenta do projeto (drizzle-kit) para manter o journal consistente — não editar
`meta/_journal.json` à mão.
