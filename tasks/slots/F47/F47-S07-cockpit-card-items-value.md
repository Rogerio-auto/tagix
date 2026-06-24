---
id: F47-S07
title: Cockpit — Card + Itens/Produto + valor + auto-enrich
phase: F47
status: in-progress
priority: high
estimated_size: M
depends_on: [F47-S03, F47-S04, F47-S06]
blocks: [F47-S08, F47-S11]
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.6 — sem card: empty state com CTA 'Criar card na pipeline'."
  - "Aplica 2.4 — ação 'Criar card' tem path óbvio (botão na seção), não menu escondido."
  - "Aplica 2.7 — adicionar item/valor com feedback imediato; valor recomputado vem da API."
  - "Aplica 8 (mobile) — seção no Sheet do cockpit; alvos ≥44px."
claimed_at: 2026-06-24T00:54:02Z

---
# F47-S07 — Cockpit: seção Card/Negócio (itens, produto, valor, auto-criação)

## Objetivo

Adicionar ao Cockpit a seção **Card/Negócio**: criar o card da conversa (botão), vincular produto do
catálogo ou item ad-hoc com valor, ver a soma virar o valor do card, e auto-criar o card na 1ª vez
que valor/produto é lançado sem deal.

## Contexto

S03 fornece itens+recompute, S04 fornece criar/auto-criar deal e o detalhe com `deal`. S06 montou a
espinha do cockpit com pontos de montagem de seção.

## Escopo (faz)

- Seção **Card/Negócio** no `ContactInfoPanel.tsx`:
  - Sem deal → CTA "Criar card na pipeline" (`POST /api/conversations/:id/deal`) com escolha de
    pipeline/estágio (default pré-selecionado); título pré-preenchido com o nome do contato.
  - Com deal → estágio + valor (BRL) + link para o board.
- Subpainel **Itens**: adicionar item via produto do catálogo (busca/seleção, `GET /api/products`)
  ou ad-hoc (nome + valor); editar qty/preço; remover. Usa `/api/deals/:id/items` (S03); a resposta
  traz `dealValueCents` recomputado (atualiza a UI sem refetch).
- **Auto-enrich**: se não há deal e o atendente lança o 1º item/valor, criar o card automaticamente
  (via o helper/rota de S04) e então adicionar o item — feedback claro ("Card criado").
- Hooks de deal/itens em `features/pipeline/queries.ts` (ou em conversations); invalidação do detalhe.

## Fora de escopo

- Seção Cliente (S06). Conversão + resumo (S08). Pipeline board/contatos (S09).

## Arquivos permitidos

- `apps/web/features/conversations/components/ContactInfoPanel.tsx` (montar a seção Card)
- `apps/web/features/conversations/components/DealSection.tsx` (novo, opcional)
- `apps/web/features/conversations/components/DealItemsEditor.tsx` (novo, opcional)
- `apps/web/features/conversations/queries.ts` (hooks de deal/itens)
- `apps/web/features/pipeline/queries.ts` (reuso de pipelines/stages p/ o picker)

## Arquivos proibidos

- `features/contacts/**` (S06/S09), `features/conversions/**` (S08), `features/products/**` (S05),
  `shared/components/layout/**` (S10), `features/pipeline/**` exceto `queries.ts`.

## Definition of Done

- [ ] Criar card pela conversa funciona e é idempotente; com deal mostra estágio+valor+link.
- [ ] Adicionar/editar/remover item atualiza o valor (Σ) vindo do servidor; produto e ad-hoc cobertos.
- [ ] Auto-criação no 1º item/valor sem deal, com feedback honesto; empty/loading/error states.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Permission scope

- Criar card / mexer em itens = `deal.edit` (STAFF). READONLY vê, não muta (controles escondidos).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Depende do `ContactInfoPanel.tsx` de S06 (sequencial). Nunca calcular a soma no cliente como verdade
  — exibir o `dealValueCents` que a API devolve (evita o drift que o S11 vai caçar).
