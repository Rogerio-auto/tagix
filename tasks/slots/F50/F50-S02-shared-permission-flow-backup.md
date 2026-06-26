---
id: F50-S02
title: Permissão flow.backup (@hm/shared)
phase: F50
status: done
priority: high
estimated_size: XS
depends_on: []
blocks: [F50-S04, F50-S05]
agent_id: backend-engineer
source_docs:
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-26T19:43:51Z
completed_at: 2026-06-26T19:45:29Z

---
# F50-S02 — Permissão `flow.backup`

## Objetivo

Adicionar a permissão `flow.backup` (OWNER/ADMIN) à matriz, gating de export/import de Flows.

## Contexto

Export pode conter URLs/headers sensíveis (`http_request`/`external_notify`) e import muta dados →
gating explícito e auditável (permissão dedicada, não reuso de `flow.edit`). `can()`, `requireRole`
e `visibleNavItems` já consomem a matriz automaticamente.

## Escopo (faz)

- `packages/shared/src/permissions.ts`: adicionar `'flow.backup': ADMINS` na seção Flow Builder
  (mesma lista OWNER/ADMIN de `flow.edit`/`flow.publish`). Atualizar o tipo `Permission` se for união literal.

## Fora de escopo

- Uso da permissão em rotas (S04) ou nav (S05).

## Arquivos permitidos

- `packages/shared/src/permissions.ts`

## Arquivos proibidos

- Todo o resto.

## Definition of Done

- [ ] `flow.backup` existe na matriz com escopo OWNER/ADMIN.
- [ ] `can('OWNER','flow.backup')` e `can('ADMIN','flow.backup')` = true; `can('AGENT','flow.backup')` = false.
- [ ] `pnpm typecheck` + `pnpm lint` verdes (tipo `Permission` inclui a chave nova).

## Permission scope

- `flow.backup` = ADMINS (OWNER/ADMIN). Ver `docs/features/PERMISSIONS.md §2` (Flow Builder).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Notas

- Conferir o nome exato da constante de grupo (`ADMINS`) no arquivo antes de editar.
