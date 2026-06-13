---
id: F27-S02
title: Aplicar PageContainer nas telas de lista/detalhe do grupo (app)
phase: F27
status: in-progress
priority: high
estimated_size: S
depends_on: [F27-S01]
agent_id: frontend-engineer
source_docs:
  - docs/DESIGN_SYSTEM.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-13T15:34:45Z

---
# F27-S02 — Aplicar PageContainer (lista/detalhe)

> **source_docs:** `docs/DESIGN_SYSTEM.md` (subseção "Largura de conteúdo", F27-S01); `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Envolver o conteúdo das **route shells de lista/detalhe** do grupo `(app)` em `<PageContainer>`, centralizando e limitando a largura no ultrawide. Aplicado no nível da `page.tsx` (não no interior dos features) para isolamento total — as 4 telas full-bleed ficam de fora (são F27 fora-de-escopo / preservadas).

## Contexto

Consome a primitiva do F27-S01. As shells em `apps/web/app/(app)/**/page.tsx` hoje renderizam o componente do feature direto, herdando o `<main>` sem `max-width` → esticam. Envolver na shell mantém os internals dos features intactos (zero overlap com F28, que edita `features/dashboard/**`).

## Escopo (faz)

Em cada `page.tsx` abaixo, envolver o componente renderizado com `<PageContainer>{...}</PageContainer>` (default 1600px). Sem alterar os componentes de feature:

- `apps/web/app/(app)/page.tsx` (Dashboard)
- `apps/web/app/(app)/agents/page.tsx` + `apps/web/app/(app)/agents/[id]/page.tsx`
- `apps/web/app/(app)/campaigns/page.tsx` + `[id]/page.tsx` + `new/page.tsx` + `[id]/edit/page.tsx`
- `apps/web/app/(app)/contacts/page.tsx`
- `apps/web/app/(app)/conversions/page.tsx`
- `apps/web/app/(app)/knowledge/page.tsx`
- `apps/web/app/(app)/flows/page.tsx` (lista — **não** o editor `flows/[id]`)

## Fora de escopo

- **Telas full-bleed (NÃO tocar, preservar edge-to-edge):** `conversations/**`, `pipeline/page.tsx` (board), `flows/[id]/page.tsx` (canvas), `calendar/page.tsx`.
- Settings/forms + `pipeline/settings` → F27-S03.
- Qualquer edição dentro de `apps/web/features/**` (internals do feature; zona compartilhada com F28). A wrap é só na `page.tsx`.

## Arquivos permitidos

- `apps/web/app/(app)/page.tsx`
- `apps/web/app/(app)/agents/page.tsx`
- `apps/web/app/(app)/agents/[id]/page.tsx`
- `apps/web/app/(app)/campaigns/page.tsx`
- `apps/web/app/(app)/campaigns/[id]/page.tsx`
- `apps/web/app/(app)/campaigns/new/page.tsx`
- `apps/web/app/(app)/campaigns/[id]/edit/page.tsx`
- `apps/web/app/(app)/contacts/page.tsx`
- `apps/web/app/(app)/conversions/page.tsx`
- `apps/web/app/(app)/knowledge/page.tsx`
- `apps/web/app/(app)/flows/page.tsx`

## Arquivos proibidos

- `apps/web/app/(app)/conversations/**`, `apps/web/app/(app)/pipeline/page.tsx`, `apps/web/app/(app)/flows/[id]/**`, `apps/web/app/(app)/calendar/**` (full-bleed — preservar)
- `apps/web/app/(app)/settings/**`, `apps/web/app/(app)/pipeline/settings/**` (F27-S03)
- `apps/web/features/**` (internals — não editar aqui)

## Definition of Done

- [ ] Todas as shells listadas envolvem o conteúdo em `<PageContainer>`; conteúdo centralizado e limitado a 1600px no ultrawide.
- [ ] Nenhuma tela full-bleed alterada (livechat, kanban, flow canvas, calendar continuam edge-to-edge — conferido no build/preview).
- [ ] Nenhum componente de feature editado (diff só em `app/(app)/**/page.tsx`).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- **§1**: leitura/escaneabilidade melhores; fim do "esticadão". **§3.6** skeleton/empty states dos features seguem intactos (a wrap não muda estado).
- **Sem regressão de §2.3** (drawers de detalhe — contacts/deal — abrem por cima normalmente; container só afeta o fluxo da página).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Mudança mecânica e de baixo risco (wrap de 1 elemento por shell).
- Dashboard: `page.tsx` envolve `<DashboardClient/>` — F28 edita o interior do `DashboardClient` (cards); sem colisão de arquivos.
- **Paralelismo:** disjunto da F26 e da F27-S03.
