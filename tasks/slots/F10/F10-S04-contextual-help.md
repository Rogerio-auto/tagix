---
id: F10-S04
title: Sistema de ajuda contextual inline (?) — HelpHint/HelpPanel + registry
phase: F10
status: review
priority: medium
estimated_size: M
depends_on: []
agent_id: frontend-engineer
source_docs:
  - docs/ROADMAP.md#F10-S04
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-12T14:14:04Z
completed_at: 2026-06-12T14:14:43Z

---
# F10-S04 — Ajuda contextual inline (?)

> **source_docs:** `docs/ROADMAP.md` F10-S04; `docs/UX_PRINCIPLES.md` §2.5/§3.3
> **blocks:** F10-S05 (a11y reusa `packages/ui`).

## Objetivo

Padrão reutilizável de **ajuda inline `?`** (DS v2 dark-first): um componente `HelpHint`/`HelpPanel` (popover/drawer lateral — **não** modal, **não** tooltip-cram) alimentado por um registry de conteúdo, e aplicado como padrão em ≥3 features flagship (dashboard, flow-builder, pipeline).

## Contexto

UX_PRINCIPLES §3.3 manda "help inline com `?`" e §2.5 proíbe usar tooltip como substituto de ajuda real. Hoje as features não têm affordance de ajuda consistente. Este slot cria o padrão citável e o aplica.

## Escopo (faz)

- `packages/ui/src/HelpHint/**`: `HelpHint` (gatilho `?` com hover/focus state) + `HelpPanel` (popover/drawer com conteúdo rico: título, corpo, link "saiba mais"). Tokens semânticos de `@hm/design-tokens`, zero hex.
- `packages/ui/src/index.ts`: export dos novos componentes.
- `apps/web/shared/lib/help-content.ts`: registry tipado `Record<HelpKey, HelpContent>`.
- `apps/web/shared/components/help/**`: wrapper que liga registry ↔ HelpHint.
- Aplicação do padrão em ≥3 telas flagship (apenas inserindo `<HelpHint k="..."/>`, sem refactor de feature).

## Fora de escopo

- Rollout em 100% das features (segue como padrão a aplicar incrementalmente).
- a11y/contraste profundo (F10-S05).

## Arquivos permitidos

- `packages/ui/src/HelpHint/**`
- `packages/ui/src/index.ts`
- `apps/web/shared/lib/help-content.ts`
- `apps/web/shared/components/help/**`

## Arquivos proibidos

- `packages/design-tokens/**` (F10-S05)
- `apps/web/next.config.mjs` (F10-S06)

## Definition of Done

- [ ] `<HelpHint>`/`<HelpPanel>` no `@hm/ui`, exportados, dark-first, tokens semânticos (zero hex).
- [ ] Registry tipado; aplicado em ≥3 telas flagship.
- [ ] Acessível por teclado (focus, Esc fecha) e não usa tooltip como ajuda (§2.5).
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Aplica **§3.3** (help inline `?`) e **§3.2** (drawer/popover lateral, não modal §2.3).
- Evita **§2.5** (tooltip-substituto): ajuda real abre painel com conteúdo, não tooltip de 1 linha.
- Evita **§2.4** (caça ao tesouro): `?` visível, com hover state claro (§3.5).
- **§2.10** (atalho-fantasma): Esc fecha, foco navegável.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/ui test
```

## Notas

- Especialista: **frontend-engineer**.
- Compartilha `packages/ui` com F10-S05 → este vem antes (S05 `depends_on` S04).
