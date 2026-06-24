---
id: F47-S13
title: Ultrareview fixes — backend (23505, race tx abortada, value_cents lock, snapshot, CEP clear)
phase: F47
status: review
priority: high
estimated_size: M
depends_on: [F47-S04, F47-S12]
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
claimed_at: 2026-06-24T02:16:30Z
completed_at: 2026-06-24T02:16:31Z

---
# F47-S13 — Correções de backend do ultrareview

Achados do cloud review (todos `normal`, todos reais) no backend da F47:

- **bug_004** — `apps/api/src/routes/products/products.ts` `isUniqueViolation` só checa `err.code`;
  o Drizzle embrulha o erro do driver e o `23505` vive em `err.cause.code` → SKU duplicado dá 500
  em vez de 409. Fix: checar `err.code` **e** `err.cause?.code` (mesmo padrão de
  `apps/api/src/routes/platform/plans.ts` e `pipeline/deal-conversation.ts`).
- **bug_001** — `pipeline/deal-conversation.ts` `ensureDealForConversation`: o catch de 23505 roda
  `tx.select` na MESMA tx que já abortou (Postgres 25P02) → o request perdedor ainda dá 500. Fix:
  trocar o try/catch por `INSERT ... ON CONFLICT (conversation_id) DO NOTHING RETURNING`, e quando
  voltar 0 linhas, re-SELECT do vencedor (padrão de `apps/api/src/routes/conversions/register.ts`).
  A tx fica saudável (sem erro). Ajustar o teste de corrida em `deal-conversation-edge.test.ts`.
- **bug_008** — `pipeline/items.ts`: mutações concorrentes de itens perdem update em
  `deals.value_cents` (READ COMMITTED, recompute lê snapshot stale + UPDATE com literal). Fix:
  travar a linha do deal no início da tx — adicionar `.for('update')` ao `loadDeal` (ou
  `pg_advisory_xact_lock`). Serializa o read-modify-write por deal.
- **bug_012** — `pipeline/deal-conversation.ts` pré-handler de snapshot roda em tx separada e
  ANTES do `next()` (close canônico em `deals/crud.ts`): (a) falha no snapshot bloqueia o close
  (500) embora o snapshot seja "aditivo"; (b) re-close (via `/reopen` + close de novo) sobrescreve
  o snapshot original. Fix: dobrar o snapshot DENTRO da tx do close com guard
  `if (!customFields.contact_snapshot)` (preserva o 1º snapshot), OU no mínimo `try/catch` no
  pré-handler (falha de snapshot não derruba o close). Preferir a 1ª opção se viável sem sair do muro.
- **bug_006 (server)** — `apps/api/src/routes/contacts/contacts.ts`: limpar CEP/UF manda `''`, que
  falha o `.regex()` antes do `.optional()` → 400. Fix: aceitar vazio-como-limpar
  (`z.literal('').or(z.string().regex(...))` ou `.transform(v => v === '' ? undefined : v)` ANTES do
  regex) para `cep` e `state` (e demais campos de address que façam sentido).

## Arquivos permitidos

- `apps/api/src/routes/products/products.ts`
- `apps/api/src/routes/pipeline/deal-conversation.ts`
- `apps/api/src/routes/pipeline/items.ts`
- `apps/api/src/routes/contacts/contacts.ts`
- `apps/api/src/routes/pipeline/*.test.ts`, `apps/api/src/routes/products/*.test.ts`,
  `apps/api/src/routes/contacts/*.test.ts`

## Arquivos proibidos

- `packages/**`, `apps/web/**`, `deals/crud.ts` (se o fix do snapshot exigir tocar o close canônico
  fora do muro, faça via guard no pré-handler em vez de editar crud.ts).

## Definition of Done

- [ ] SKU duplicado → 409 `duplicate_sku` (POST e PATCH); teste com erro embrulhado (cause.code).
- [ ] Race de auto-create: 2 POST concorrentes = 1 deal e **nenhum 500** (tx não aborta); teste estrito.
- [ ] `deals.value_cents` correto sob mutações concorrentes (lock); teste cobre.
- [ ] Falha de snapshot não bloqueia o close; re-close preserva o snapshot original; teste cobre.
- [ ] Limpar CEP/UF (string vazia) → 200 (campo limpo), não 400; teste cobre.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes (rate-limit.test.ts falha pré-existente OK).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Postgres dev via Docker bin `C:\Program Files\Docker\Docker\resources\bin`. NÃO rode git/pnpm install.
- O `onConflictDoNothing` precisa do target `deals.conversation_id` (unique parcial 0053 já existe).
