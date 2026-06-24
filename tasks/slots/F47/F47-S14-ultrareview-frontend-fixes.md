---
id: F47-S14
title: Ultrareview fixes — frontend (parser de dinheiro, archive mobile, ViaCEP stale, CEP clear)
phase: F47
status: in-progress
priority: high
estimated_size: M
depends_on: [F47-S05, F47-S06, F47-S07, F47-S08]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 8 (mobile) — botão Arquivar visível no touch (sem depender de hover)."
  - "Aplica 2.7/2.11 — erros de cadastro acionáveis (surfacing de issue do Zod)."
claimed_at: 2026-06-24T02:16:44Z

---
# F47-S14 — Correções de frontend do ultrareview

Achados do cloud review (todos `normal`, reais) no frontend da F47:

- **bug_009 (corrupção de valor)** — `apps/web/features/conversations/components/DealItemsEditor.tsx`
  `parseReaisToCents` tira TODOS os pontos → `'1.5'` vira 1500 cents (R$15) e `'12.34'` vira R$1234.
  Fix: importar e usar `parseToCents` de `@/features/products/money` (já existe, desambigua
  `,` vs `.` por `lastIndexOf`) nos dois call sites (`ItemRow.save` e `AddItemForm.submit`). Também
  em `apps/web/features/conversions/MarkConversionModal.tsx`: trocar `Number(valueReais)` por
  `parseToCents` (hoje `'1500,00'` vira NaN → `null` silencioso) e o pré-preenchimento (S08) do valor
  herdado deve usar formato pt-BR (`toLocaleString('pt-BR', { minimumFractionDigits: 2 })`) p/ casar
  com o label "Valor (R$)".
- **bug_016 (mobile)** — `apps/web/features/products/ProductsCatalog.tsx` botão Arquivar é
  `opacity-0 group-hover:opacity-100` → invisível no touch (sem hover; `:focus-visible` não dispara em
  tap). Fix: remover `opacity-0`/`group-hover`/`focus-visible:opacity-100` (ícone sempre visível,
  `text-text-low` em repouso, `hover:text-danger`).
- **bug_003 (perda de dado)** — `apps/web/features/contacts/components/AddressForm.tsx` `runLookup`
  captura `value` do render que iniciou o fetch; ao resolver o ViaCEP, o spread `{...value}` sobrescreve
  campos (Número/Complemento) digitados durante o fetch. Fix: `const valueRef = useRef(value);
  valueRef.current = value;` e mesclar contra `valueRef.current` no branch pós-await (ou aplicar só os
  campos derivados do CEP via `patch()`).
- **bug_006 (client)** — `apps/web/features/contacts/components/ContactPanel.tsx` `save` manda
  `address: draft.address` verbatim; campos vazios (`cep: ''`, `state: ''`) viram 400 no backend. Fix:
  normalizar strings vazias de `draft.address` para `undefined` antes de enviar (espelhar o que já é
  feito p/ phone/email/document). E no `onError`, exibir as `issues` do `ApiError` (qual campo falhou)
  em vez de toast genérico. (O backend tb está sendo endurecido na S13 — aqui é defesa do cliente + UX.)

## Arquivos permitidos

- `apps/web/features/conversations/components/DealItemsEditor.tsx`
- `apps/web/features/conversions/MarkConversionModal.tsx`
- `apps/web/features/products/ProductsCatalog.tsx`
- `apps/web/features/contacts/components/AddressForm.tsx`
- `apps/web/features/contacts/components/ContactPanel.tsx`
- `apps/web/features/products/money.ts` (só se precisar exportar/ajustar — preferir reusar como está)

## Arquivos proibidos

- `apps/api/**`, `packages/**`, outras features não citadas, `shared/components/layout/**`.

## Definition of Done

- [ ] `1.5`/`12.34` (ponto-decimal) e `129,90` (vírgula) parseiam corretos em itens e conversão.
- [ ] Botão Arquivar visível e tocável no mobile (sem hover).
- [ ] Digitar Número/Complemento durante o lookup ViaCEP não é sobrescrito ao resolver.
- [ ] Limpar CEP/UF e salvar não dá erro genérico; campo limpo persiste; issue do Zod aparece se houver.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- NÃO rode git/pnpm install. DS v2 zero hex. Reusar `parseToCents` (não reescrever parser).
