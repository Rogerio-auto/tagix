---
id: F31-S12
title: Docs FLOW_BUILDER + e2e Playwright do builder v2
phase: F31
status: done
priority: medium
estimated_size: S
depends_on: [F31-S01, F31-S02, F31-S04, F31-S05, F31-S06, F31-S07, F31-S09, F31-S10, F31-S11]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T20:01:33Z
completed_at: 2026-06-15T20:07:43Z

---
# F31-S12 — Docs + e2e do Flow Builder v2

## Objetivo

Fechar a fase: atualizar a doc do Flow Builder (de "14 node types" para o catálogo real) e cobrir o builder v2 com e2e Playwright.

## Contexto

`FLOW_BUILDER.md` está defasada. Falta um e2e que construa um flow real (trigger → mensagem rica → interactive → condition) e confirme o envio end-to-end via WAHA dev.

## Escopo (faz)

- `docs/features/FLOW_BUILDER.md` — catálogo real de nodes, novos tipos, blocker resolvido, contrato de saída.
- `apps/web/e2e/flow-builder-v2.spec.ts` (ou path e2e do projeto) — construir flow, salvar, disparar, asserir envio + roteamento.

## Fora de escopo

- Implementação dos nodes (slots anteriores). `validation.ts` (dono: S08).

## Arquivos permitidos

- `docs/features/FLOW_BUILDER.md`
- `apps/web/e2e/flow-builder-v2.spec.ts`

## Arquivos proibidos

- Qualquer `packages/flow-engine/src/**`, `apps/web/features/flow-builder/**`.

## Definition of Done

- [ ] FLOW_BUILDER.md reflete o catálogo e o estado v2.
- [ ] e2e cobre construir+disparar+enviar (happy path) verde.
- [ ] `pnpm typecheck` + `pnpm lint` + e2e verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test:e2e
```

## Notas

- e2e precisa de infra dev (Docker) + canal WAHA. Relacionado: [[tagix-flow-builder-v2-survey]].
