---
id: F47-S08
title: Cockpit — Conversão herdando valor + resumo financeiro
phase: F47
status: review
priority: medium
estimated_size: S
depends_on: [F47-S07]
blocks: [F47-S11]
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.3 — marcar conversão reusa MarkConversionModal (sheet no mobile), não tela cheia."
  - "Aplica 2.7 — botão com loading; dedup 409 → mensagem amigável (já existe no modal)."
  - "Aplica 2.6 — resumo financeiro vazio (cliente sem conversão) tem estado honesto."
claimed_at: 2026-06-24T00:59:31Z
completed_at: 2026-06-24T00:59:32Z

---
# F47-S08 — Cockpit: Conversão (valor herdado) + resumo financeiro do contato

## Objetivo

Adicionar ao Cockpit o botão **Marcar conversão** (reusando `MarkConversionModal`) com o valor já
herdado do card/itens, e um mini **resumo financeiro** do contato no topo do painel.

## Contexto

`MarkConversionModal` (F5-S13) já existe e aceita `contactId`/`dealId`/`valueCents`. S07 deixou o
deal com valor. Falta acionar a conversão de dentro do cockpit, herdando esse valor.

## Escopo (faz)

- Botão **Marcar conversão** na seção Card (ou nova seção Conversão) do `ContactInfoPanel.tsx`,
  abrindo `MarkConversionModal` com `contactId`, `dealId` e o valor do card pré-preenchido
  (`valueFrom: 'deal'` — não redigitar). Gate `deal.convert`.
- **Resumo financeiro** no topo/seção do cockpit: total convertido, nº de deals, ticket médio
  (derivar do detalhe do contato / conversões já carregadas). Estado vazio honesto.
- Invalidação dos caches certos após registrar conversão (detalhe da conversa/contato).

## Fora de escopo

- O modal em si (reuso, não reescrever). Itens/criar card (S07). Cliente (S06).

## Arquivos permitidos

- `apps/web/features/conversations/components/ContactInfoPanel.tsx` (botão + resumo)
- `apps/web/features/conversations/components/ConversionSection.tsx` (novo, opcional)
- `apps/web/features/conversions/**` (apenas se precisar expor prop de valor pré-preenchido)

## Arquivos proibidos

- `features/contacts/**`, `features/pipeline/**`, `features/products/**`,
  `shared/components/layout/**`, `apps/api/**`.

## Definition of Done

- [ ] Marcar conversão pelo cockpit herda o valor do card (não pede redigitar); dedup 409 amigável.
- [ ] Resumo financeiro correto (total/nº/ticket) com estado vazio; cache invalida após registro.
- [ ] DS v2 sem hex; mobile via sheet; `pnpm typecheck` + `pnpm lint` + build verdes.

## Permission scope

- Marcar conversão = `deal.convert` (STAFF). Botão escondido para READONLY.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Sequencial após S07 (mesmo `ContactInfoPanel.tsx`). Se o `MarkConversionModal` ainda não aceita
  `valueCents` pré-preenchido, adicionar a prop de forma retrocompatível (default = comportamento atual).
