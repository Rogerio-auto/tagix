---
id: F50-S06
title: Fix — download do export não dispara (revoke do blob cedo demais)
phase: F50
status: review
priority: high
estimated_size: XS
depends_on: [F50-S05]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
claimed_at: 2026-06-26T20:45:26Z
completed_at: 2026-06-26T20:46:41Z

---
# F50-S06 — Fix do download do export de Flows

## Objetivo

Corrigir o "Exportar e baixar": o arquivo não baixa porque `downloadEnvelope` chama
`a.remove()` + `URL.revokeObjectURL(url)` SINCRONAMENTE logo após `a.click()`, o que
cancela o download em Chrome/Firefox (o browser ainda não leu o blob). Adiar a limpeza.

## Contexto

Bug reportado em prod (2026-06-26): clicar em "Exportar e baixar" não baixa nada. Servidor ok
(endpoint 200, E2E validado). Causa = revoke prematuro do object URL (padrão conhecido — FileSaver
usa setTimeout antes de revogar).

## Escopo (faz)

- `apps/web/features/flow-builder/backup/BackupPage.tsx`: em `downloadEnvelope`, manter o anchor no
  DOM e adiar `a.remove()` + `URL.revokeObjectURL(url)` para um `setTimeout(..., ~1000ms)` após o
  `click()`. Adicionar `a.rel = 'noopener'`. Sem mudar a chamada de export nem o toast.

## Fora de escopo

- Lógica de export/import (S03/S04). Qualquer outra parte da UI.

## Arquivos permitidos

- `apps/web/features/flow-builder/backup/BackupPage.tsx`

## Arquivos proibidos

- Todo o resto.

## Definition of Done

- [ ] `downloadEnvelope` não revoga o object URL no mesmo tick do `click()` (defer via setTimeout).
- [ ] Export baixa o arquivo `leadium-flows-backup-<data>.json` (validado em prod após deploy).
- [ ] `pnpm typecheck` + `pnpm lint` + build do web verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Notas

- e2e não hidrata neste host → validar por typecheck/lint/build + smoke manual em prod.
