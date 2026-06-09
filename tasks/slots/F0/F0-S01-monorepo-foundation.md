---
id: F0-S01
title: Monorepo pnpm + tsconfig base + lint + skeletons de packages/apps
phase: F0
status: done
priority: high
depends_on: []
---

# F0-S01 — Monorepo pnpm + tsconfig base + lint + skeletons

## Objetivo

Materializar a fundação do monorepo: workspace pnpm, TypeScript strict end-to-end,
ESLint flat (zero `any`) + Prettier, e skeletons reais e tipados de todos os
packages e apps. `pnpm install`, `pnpm typecheck` e `pnpm lint` passam limpos.

## Escopo

### files_allowed

- `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `.editorconfig`
- `tsconfig.base.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.env.example`
- `packages/**`
- `apps/**`

## Definition of Done

- [x] `pnpm install` ok (13 workspace projects)
- [x] `pnpm typecheck` ok (12 projetos TS)
- [x] `pnpm lint` ok (exit 0)
- [x] Skeletons existem: 9 packages (shared, db, logger, storage, channels, flow-engine, agents-client, ui, design-tokens) + 4 apps (api, web, workers, agent-runtime)
- [x] TypeScript strict + `no-explicit-any: error`
- [x] `.env.example` com placeholders (sem secrets reais); `.env` no `.gitignore`

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Notas

- Stack travada nos ADRs do `docs/INDEX.md`. Node 22+ (máquina dev tem v24), pnpm via npm global.
- `agent-runtime` é Python (pyproject + app/), fora do typecheck pnpm; roda com `uv` (F2 / runbook Windows).
- Próximos: F0-S02 (Docker Compose — já existe `infra/docker/docker-compose.dev.yml` base), F0-S03 (Drizzle schema), F0-S05/06 (auth + Express).
