---
id: F38-S14
title: QA da fase (integration + e2e happy paths)
phase: F38
status: available
priority: high
estimated_size: M
depends_on:
  - F38-S04
  - F38-S05
  - F38-S06
  - F38-S09
  - F38-S11
  - F38-S13
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: qa-engineer
---
# F38-S14 — QA da fase

## Objetivo

Validar a fase ponta a ponta: integration nos fluxos de ajuda/suporte/API e e2e happy paths. Caçar gaps de estado, edge cases e regressões.

## Contexto

Help (CMS + leitor + contextual), Support (membro + platform + real-time) e API v1 nova + portal já implementados. e2e Playwright **não hidrata neste host** (gotcha conhecido) → validar web por typecheck/lint/build/unit; escrever specs e2e mas não exigir verde local.

## Escopo (faz)

- Integration: leitor só vê publicados; FTS; feedback upsert; IDOR de support thread (404); gate platform-admin; novos endpoints v1 (scope 403 + tenant isolation); real-time de suporte (join autorizado).
- e2e (specs, podem não rodar verde local): abrir artigo de ajuda; abrir thread de suporte e receber reply; navegar o portal de API.
- Relatório de gaps em `tasks/COMMS.md` (append-only) com severidade.

## Arquivos permitidos

- `apps/api/src/**/*.test.ts`
- `apps/web/e2e/**`
- `tasks/COMMS.md`

## Arquivos proibidos

- Código de produção (só testes). Schema/migrations.

## Definition of Done

- [ ] Integration cobre os caminhos críticos e os controles de acesso (IDOR, scopes, gate).
- [ ] Specs e2e dos happy paths escritas.
- [ ] Gaps reportados em COMMS.md; `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Notas

Se achar bug de produção, **não** corrige aqui (fora do files_allowed) — reporta em COMMS.md e o orchestrator abre sub-slot. e2e: documentar como "escrito, não-verde local" se for o caso (gotcha de hidratação).
</content>
