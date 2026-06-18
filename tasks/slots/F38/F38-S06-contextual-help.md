---
id: F38-S06
title: Help contextual (?) — HelpHint em @hm/ui + anchors nas features
phase: F38
status: available
priority: medium
estimated_size: M
depends_on:
  - F38-S05
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
---
# F38-S06 — Help contextual (?)

## Objetivo

Primitive `HelpHint`/`HelpPopover` em `@hm/ui` que recebe um `anchorKey`, busca o artigo por âncora (API S03 `by-anchor`) e abre em popover/sheet com link "ver artigo completo". Plugado nos headers de um conjunto curado de features. Fecha o débito do antigo F10-S04.

## Contexto

`@hm/ui` é o pacote de primitives DS v2. A API `GET /api/help/articles/by-anchor/:anchorKey` (S03) resolve âncora → artigo publicado. Os `anchor_key` são definidos nos artigos pelo CMS (S04).

## Escopo (faz)

- **`packages/ui/src/help-hint/**`** (novo) — `HelpHint` (ícone `(?)` acessível) que ao abrir consulta a âncora e mostra excerpt + CTA "ver no /help". Fallback silencioso se não houver artigo. Sem hex; tokens DS v2.
- **`packages/ui/src/index.ts`** — export explícito.
- **PageHeader curado** — wiring em um conjunto de headers de feature (ex.: Agentes, Flows, Pipeline, Campanhas, Conversões) passando `anchorKey`. Tocar **apenas** os arquivos de header/`PageHeader` necessários (listar no PR).

## Fora de escopo

- Conteúdo dos artigos (CMS S04). Leitor (S05). Backend.

## Arquivos permitidos

- `packages/ui/src/help-hint/**`
- `packages/ui/src/index.ts`
- `apps/web/shared/components/layout/PageHeader.tsx`
- `apps/web/features/agents/**`
- `apps/web/features/flows/**`
- `apps/web/features/pipeline/**`
- `apps/web/features/campaigns/**`
- `apps/web/features/conversions/**`

## Arquivos proibidos

- `apps/api/**`, `packages/db/**`

## Definition of Done

- [ ] `HelpHint` renderiza, busca por âncora e linka pro artigo; fallback quando ausente.
- [ ] Plugado em ≥5 headers de feature com `anchorKey` estável.
- [ ] Ladle story do primitive; ARIA (button + popover/dialog); DS v2 tokens.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Notas

Manter o wiring nas features minimalista: só adicionar o `anchorKey`/`HelpHint` ao header, sem refatorar a feature. Se um header não expõe slot pra ação, preferir o `PageHeader` compartilhado.
</content>
