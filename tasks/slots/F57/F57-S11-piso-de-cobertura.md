---
id: F57-S11
title: Piso de cobertura no CI — nada de "testes acompanham o código" sem medição
phase: F57
status: available
priority: medium
estimated_size: M
depends_on: [F57-S01]
blocks: []
agent_id: qa-engineer
source_docs:
  - eslint.config.mjs
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S11 — 1.900 testes, zero medição

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08).

## Objetivo

Medir cobertura e travar um piso, para que o próximo slot não possa entregar sem
teste e ainda assim ficar verde.

## Contexto / causa raiz (verificada)

O volume de teste é real e bom: **218 arquivos de teste, ~1.900 testes**, incluindo o
`packages/db/src/rls.test.ts` (isolamento A/B tabela por tabela) — provavelmente o
melhor teste do repositório.

Mas:

- Nenhum dos 9 `vitest.config.ts` define bloco `coverage` ou `thresholds`
  (`grep -rn 'thresholds\|coverage' --include=vitest.config.* .` = vazio).
- Nenhum `@vitest/coverage-v8` instalado.
- O CI roda `pnpm -r --if-present test` e nunca coleta cobertura.
- `apps/workers` tem `"test": "vitest run"` **sem** `vitest.config.ts` próprio.

O `CLAUDE.md` do projeto afirma *"Testes acompanham o código (Vitest
unit/integration, Playwright e2e)"* e o `_TEMPLATE.md` de slot traz
`[ ] Testes do feliz path passam` no DoD. Nada disso é **verificável**: um slot pode
entregar 800 linhas sem um teste e passar em todos os gates. Com 407 slots já
entregues, ninguém sabe onde estão os vazios.

## Escopo (faz)

- Instalar `@vitest/coverage-v8`; config de cobertura compartilhada (provider v8,
  reporters `text` + `lcov` + `json-summary`).
- Medir o baseline **primeiro** e registrar por package em `docs/audits/`.
- Travar `thresholds` **no baseline medido** (não num número aspiracional) — para
  que a cobertura só possa subir. Pisos maiores onde o risco é maior: `packages/db`,
  `packages/shared`, `apps/api/src/middlewares`, `packages/payments`.
- Criar `apps/workers/vitest.config.ts`.
- Step no CI que coleta cobertura e falha abaixo do piso; publicar o `lcov` como
  artifact.
- Anotar no `_TEMPLATE.md` que o DoD de teste é medido, não declarado.

## Escopo (não faz)

- Escrever teste novo para subir número. Este slot **instala a régua**. Os buracos
  que a régua expuser viram slots próprios (registrar em `tasks/COMMS.md`).
- Cobertura de e2e / Playwright.

## Arquivos permitidos

- `package.json`
- `apps/*/package.json`
- `packages/*/package.json`
- `apps/*/vitest.config.ts`
- `packages/*/vitest.config.ts`
- `vitest.shared.ts`
- `.github/workflows/ci.yml`
- `.gitignore`
- `tasks/_TEMPLATE.md`
- `docs/audits/**`

## Arquivos proibidos

- Qualquer `**/*.test.ts` / `**/*.test.tsx` (este slot não altera teste existente)
- `apps/*/src/**`, `packages/*/src/**`

## Definition of Done

- [ ] `pnpm -r test` gera relatório de cobertura por package.
- [ ] Baseline documentado em `docs/audits/` com data e sha.
- [ ] `thresholds` no baseline; CI falha se cair (validar comentando um teste).
- [ ] `apps/workers` com `vitest.config.ts` próprio.
- [ ] `lcov` publicado como artifact do CI.
- [ ] Diretórios de cobertura no `.gitignore` (`**/coverage` já está — confirmar).

## Validação

```bash
pnpm -r --if-present test
```

## Notas

- Piso no baseline, jamais um número redondo inventado. Threshold aspiracional
  vira `--coverage=false` no primeiro deploy apertado, e aí a régua morre.
- Espere cobertura **muito** desigual: `packages/db` e `apps/api` devem estar altos,
  `apps/web` (186 testes para 69k LOC) provavelmente baixo. O relatório é o mapa dos
  próximos slots de QA.
