---
id: F0-S16
title: CI GitHub Actions — lint + typecheck + build + test (+ deploy SSH inerte)
phase: F0
status: available
priority: medium
estimated_size: S
depends_on: [F0-S01]
---

# F0-S16 — CI/CD GitHub Actions

> **source_docs:** `docs/INFRASTRUCTURE.md` §CI/CD; `docs/ARCHITECTURE.md` ADR-CI

## Objetivo

Pipeline de CI que roda em PR/push: install (pnpm + cache), typecheck, lint, build, test. Job de deploy via SSH para a VPS fica **pronto porém inerte** até a VPS/segredos existirem.

## Escopo (faz)

- `infra/github-actions/ci.yml` (ou `.github/workflows/ci.yml`) — matrix Node 22, pnpm/store cache, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm -r build`, `pnpm -r test`. Serviços Postgres/Redis para testes de integração.
- Job `deploy` (gate `if: github.ref == 'refs/heads/main' && secrets.VPS_HOST`) — rsync/ssh; não roda sem os secrets.

## Arquivos permitidos

- `.github/workflows/**`, `infra/github-actions/**`

## Definition of Done

- [ ] Workflow YAML válido (lint de actions / `act` opcional).
- [ ] Passos cobrem lint/typecheck/build/test.
- [ ] Deploy condicionado a secrets (não falha sem VPS).

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- **Bloqueador externo:** deploy real exige VPS + secrets (`VPS_HOST`, `VPS_SSH_KEY`, etc.) no GitHub. Note ordering: gerar `next-env.d.ts` (build do web) antes do typecheck no CI, ou rodar `next build` que já typa.
