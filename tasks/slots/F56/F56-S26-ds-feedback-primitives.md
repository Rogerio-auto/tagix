---
id: F56-S26
title: DS — promover EmptyState/Skeleton/ErrorState para @hm/ui
phase: F56
status: done
priority: medium
estimated_size: M
depends_on: []
blocks: [F56-S27]
agent_id: frontend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-17T23:51:12Z

---
# F56-S26 — Primitivos de feedback no DS versionado (DS-01/03/04)

> **Origem:** AUDITORIA_TECNICA.md §3.9. O DS é bifurcado: `@hm/ui` expõe 8 primitivos; EmptyState/Skeleton/ErrorState vivem soltos em `apps/web/shared` sem governança → ~70 empties inline e 42 `animate-pulse` à mão.

## Objetivo

Estabelecer os primitivos de feedback como parte do DS versionado (`@hm/ui`), com estados e `motion-reduce`, para acabar com as reimplementações.

## Contexto / causa raiz (verificada)

`packages/ui/src/index.ts` (8 exports); `apps/web/shared/components/feedback/{EmptyState,Skeleton,ErrorState}.tsx` fora da fronteira. Skeletons inline sem `prefers-reduced-motion` garantido.

## Escopo (faz)

- Criar `EmptyState` (variantes first-run/no-results/error-adjacent, com CTA), `Skeleton`/`SkeletonText`/`SkeletonCard` (com `motion-reduce:animate-none`) e `ErrorState` em `@hm/ui`, com stories Ladle.
- Exportá-los pelo barrel `packages/ui/src/index.ts` (declarar aqui também os exports de Drawer/IconButton que F56-S27 preencherá — ou deixar S27 sem tocar o barrel; ver notas).

## Escopo (não faz)

- Sweep de adoção nas ~70 telas (follow-up dedicado — colide com slots de feature).
- Drawer/IconButton (F56-S27).

## Arquivos permitidos

- `packages/ui/src/EmptyState/**`
- `packages/ui/src/Skeleton/**`
- `packages/ui/src/ErrorState/**`
- `packages/ui/src/index.ts`

## Arquivos proibidos

- `packages/ui/src/Drawer/**` · `packages/ui/src/IconButton/**` (F56-S27) · `apps/web/**`

## Definition of Done

- [ ] EmptyState/Skeleton/ErrorState em `@hm/ui` com estados + `motion-reduce`.
- [ ] Stories Ladle; `pnpm --filter @hm/ui ladle:build` verde.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations (docs/UX_PRINCIPLES.md / DESIGN_SYSTEM.md)

- Empty state acionável (com CTA), não texto morto.
- Skeleton com a forma do shell (sem CLS) e respeitando `prefers-reduced-motion`.
- Estados consistentes entre light/dark (tokens semânticos, zero hex).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/ui ladle:build
```

## Notas

- Este slot é o **único dono de `packages/ui/src/index.ts`** nesta fase; F56-S27 cria os componentes Drawer/IconButton mas o export deles entra aqui (pré-declarado) ou é adicionado por S27 após merge — combinar via COMMS para não colidir no barrel.
