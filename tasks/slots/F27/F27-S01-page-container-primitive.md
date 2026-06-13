---
id: F27-S01
title: PageContainer primitive + token de largura de conteúdo (DS)
phase: F27
status: review
priority: high
estimated_size: S
depends_on: []
agent_id: frontend-engineer
source_docs:
  - docs/DESIGN_SYSTEM.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-13T15:20:06Z
completed_at: 2026-06-13T15:33:32Z

---
# F27-S01 — PageContainer + token de largura

> **source_docs:** `docs/DESIGN_SYSTEM.md` (nova subseção "Largura de conteúdo"); `docs/UX_PRINCIPLES.md` §1
> **blocks:** F27-S02, F27-S03

## Objetivo

Criar a primitiva de layout `<PageContainer>` que centraliza e limita a largura do conteúdo (default **1600px**, variante `narrow` ~900px p/ forms, variante `full` no-op p/ telas full-bleed), apoiada num token semântico `max-w-content` no preset Tailwind do DS. Resolve a raiz do problema de ultrawide: `AppLayout <main>` não tem `max-width`, então tudo estica de ponta a ponta.

## Contexto

`apps/web/shared/components/layout/AppLayout.tsx:36` define `<main className="flex-1 px-4 py-6 lg:px-8">` — sem limite de largura. O padrão `mx-auto max-w-*` já existe avulso no codebase (ex: home do `(platform)`), mas nunca foi sistematizado nem aplicado no grupo `(app)`. Este slot entrega a primitiva + o token + a documentação; a aplicação nas páginas é F27-S02 (lista/detalhe) e F27-S03 (settings/forms).

## Escopo (faz)

- `packages/design-tokens/src/tailwind-preset.ts`: adicionar `theme.extend.maxWidth` com `content: '1600px'` e `'content-narrow': '900px'` + estender a interface `TailwindPreset` (campo `maxWidth: Record<string,string>`). Mantém o objeto `readonly` e tipado.
- `apps/web/shared/components/layout/PageContainer.tsx` (novo): componente que envolve `children` em `mx-auto w-full` + `max-w-content` (default), com prop `variant?: 'default' | 'narrow' | 'full'` (`narrow` → `max-w-content-narrow`; `full` → sem `max-w`, passthrough) e `className?` para composição. Server-component-safe (sem `'use client'`).
- `apps/web/shared/components/layout/index.ts` (se existir barrel) ou export direto: expor `PageContainer`.
- `apps/web/shared/components/layout/AppLayout.tsx`: ajuste mínimo se necessário (manter `px-*`/`py-*` como gutter externo; **não** adicionar `max-width` aqui — a largura é responsabilidade do `PageContainer`, para preservar telas full-bleed).
- `docs/DESIGN_SYSTEM.md`: nova subseção curta "Largura de conteúdo" documentando o token `content`/`content-narrow`, o default 1600px e a regra "telas full-bleed (livechat, kanban, flow canvas, calendar) usam `variant="full"`/não envolvem".

## Fora de escopo

- Aplicar o `PageContainer` em qualquer página (F27-S02 / F27-S03).
- Qualquer mudança em `packages/db`, `apps/api`, `apps/web/features/**` ou `apps/web/app/(platform)/**` (zona F26).

## Arquivos permitidos

- `packages/design-tokens/src/tailwind-preset.ts`
- `apps/web/shared/components/layout/PageContainer.tsx`
- `apps/web/shared/components/layout/index.ts`
- `apps/web/shared/components/layout/AppLayout.tsx`
- `docs/DESIGN_SYSTEM.md`

## Arquivos proibidos

- `apps/web/app/**` (aplicação é F27-S02/S03)
- `apps/web/features/**`, `apps/api/**`, `packages/db/**`, `apps/web/app/(platform)/**`

## Contratos de saída

- `export function PageContainer(props: { children: ReactNode; variant?: 'default' | 'narrow' | 'full'; className?: string }): JSX.Element`
- Token Tailwind utilizável: `max-w-content`, `max-w-content-narrow`.

## Definition of Done

- [ ] `PageContainer` criado com as 3 variantes; `default` = `mx-auto w-full max-w-content`; `full` não impõe `max-w`.
- [ ] Token `maxWidth.content`/`content-narrow` no preset + interface `TailwindPreset` estendida (sem `any`).
- [ ] `docs/DESIGN_SYSTEM.md` documenta a regra de largura e a exceção full-bleed.
- [ ] Zero hex hardcoded; sem `'use client'` desnecessário; tipagem estrita.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- **§1** (fluido, sem poluição): linha de leitura controlada melhora escaneabilidade no ultrawide; respiro lateral em vez de conteúdo esticado.
- **Sem regressão**: drawers/modais (§2.3) e density (§3.8) não são afetados — o container só limita largura do fluxo principal. Telas full-bleed (livechat 3-col, pipeline kanban, flow canvas, calendar) preservam edge-to-edge via `variant="full"`/não-envolvimento (decisão travada com o fundador).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**.
- Largura 1600px = decisão travada com o fundador (monitor ultrawide; referência Linear/Stripe centered content).
- **Paralelismo:** F27 inteira é frontend-only e disjunta da F26. Este slot NÃO toca `packages/db` (zona F26-S01 in-progress) nem `platform-admin`.
- Tailwind 4: o preset é consumido por `apps/web/tailwind.config.ts` via `presets: [tailwindPreset]` — `max-w-content` passa a existir automaticamente.
