---
id: F47-S03
title: API Itens do card + recompute de value_cents
phase: F47
status: done
priority: high
estimated_size: M
depends_on: [F47-S01]
blocks: [F47-S07, F47-S11]
agent_id: backend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/DATA_MODEL.md
claimed_at: 2026-06-24T00:21:14Z
completed_at: 2026-06-24T00:21:15Z

---
# F47-S03 — API de itens do card (line-items) + recompute do valor

## Objetivo

Gerenciar os itens de um deal (produto do catálogo OU item ad-hoc) e manter
`deals.value_cents` = Σ(qty × unit_price_cents) recomputado no servidor, com trilha em `deal_history`.

## Contexto

S01 criou `deal_items`. O valor do deal é a fonte para a conversão (`valueFrom: 'deal'`), então a
soma precisa ser autoritativa do servidor — nunca confiar no cliente.

## Escopo (faz)

- **Rotas** em `apps/api/src/routes/pipeline/` (dono de deals):
  - `GET /api/deals/:id/items` → lista de itens do deal. Gate `pipeline.view` (+ visibilidade do deal).
  - `POST /api/deals/:id/items` — adiciona item. Body: `productId?` (se vier, snapshota
    `name_snapshot`/`unit_price_cents` do produto no momento) **ou** `nameSnapshot`+`unitPriceCents`
    (ad-hoc) + `qty`. Gate `deal.edit`.
  - `PATCH /api/deals/:id/items/:itemId` — edita qty/preço/nome. Gate `deal.edit`.
  - `DELETE /api/deals/:id/items/:itemId` — remove. Gate `deal.edit`.
- **Recompute transacional:** toda mutação recalcula `deals.value_cents` na MESMA transação e grava
  `deal_history(event_type='field_updated', from/to value_cents)`.
- Validação Zod (`qty>0`, `unit_price_cents>=0`); 404 se deal/item fora do workspace.
- Testes: soma correta após add/edit/delete; concorrência (duas mutações não corrompem a soma);
  authz; produto inativo/excluído ainda referenciável via snapshot.

## Fora de escopo

- Catálogo de produto (S02). Criar/auto-criar deal (S04). UI (S07).

## Arquivos permitidos

- `apps/api/src/routes/pipeline/items.ts` (novo) + registro no router de pipeline existente
- `apps/api/src/routes/pipeline/pipelines.test.ts` (estender) ou `items.test.ts` (novo)

## Arquivos proibidos

- `packages/db/**`, `apps/web/**`, `apps/api/src/routes/conversations/**` (S04),
  `apps/api/src/routes/products/**` (S02).

## Contratos de entrada/saída

- `POST /api/deals/:id/items` `{ productId?, nameSnapshot?, unitPriceCents?, qty }`
  → `{ item: DealItem, dealValueCents: number }`.
- Toda resposta de mutação devolve o `dealValueCents` recomputado (cliente atualiza sem refetch).

## Definition of Done

- [ ] `deals.value_cents` sempre = Σ(itens) após qualquer mutação (testado).
- [ ] Mutações gravam `deal_history`; produto excluído não quebra item (snapshot preservado).
- [ ] Authz `deal.edit`; visibilidade do deal respeitada; cross-workspace 404.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Permission scope

- Ler itens = `pipeline.view` (ALL, sujeito à visibilidade do deal). Mutar = `deal.edit` (STAFF).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Recompute na transação evita drift (risco mapeado para o QA S11). Use o helper de soma do repo (S01).
- `name_snapshot`/`unit_price_cents` no item = imutável ao item; mudar preço do produto NÃO altera
  itens já lançados (comportamento de nota fiscal). Documentar no código.
