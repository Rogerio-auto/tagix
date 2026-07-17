---
id: F56-S28
title: DS — tokenizar e aplicar a escala tipográfica editorial
phase: F56
status: done
priority: medium
estimated_size: M
depends_on: []
blocks: []
agent_id: frontend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-17T23:51:12Z

---
# F56-S28 — Escala tipográfica editorial (DS-06)

> **Origem:** AUDITORIA_TECNICA.md §3.9. `typography.ts` declara a escala editorial (h1 60px, body 17px…) mas tem 0 consumo; o produto renderiza na escala genérica do Tailwind (`text-sm` 719×), aquém do padrão editorial de referência.

## Objetivo

Transformar a escala editorial declarada em tokens/utilitários consumíveis, elevando o teto de hierarquia visual para o padrão (Linear/Stripe).

## Contexto / causa raiz (verificada)

`packages/design-tokens/src/typography.ts` sem nenhum import; sem `--font-size-*`/`--text-*` no `@theme`.

## Escopo (faz)

- Tokenizar a escala como utilitários (`text-h1…text-small`) no `@theme` do design-tokens.
- Documentar o mapeamento no `DESIGN_SYSTEM.md` (via design-tokens docs se aplicável).

## Escopo (não faz)

- Aplicar a escala em todas as telas (sweep de adoção — follow-up; colide com slots de feature).
- Novos primitivos (F56-S26/S27).

## Arquivos permitidos

- `packages/design-tokens/src/**`

## Arquivos proibidos

- `packages/ui/**` · `apps/web/**`

## Definition of Done

- [ ] Utilitários `text-h1…text-small` disponíveis a partir dos tokens.
- [ ] `typography.ts` deixa de ser documentação morta (é a fonte dos utilitários).
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations (docs/DESIGN_SYSTEM.md)

- Escala editorial (dark-first) como identidade visual, não a escala genérica.
- Tokens semânticos, zero hex, coerência light/dark.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- Manter compat: os utilitários novos coexistem com `text-sm`/`text-xs`; a migração de telas é gradual (follow-up).
