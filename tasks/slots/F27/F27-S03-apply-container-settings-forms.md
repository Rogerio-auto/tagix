---
id: F27-S03
title: Aplicar PageContainer em settings/forms + validar full-bleed
phase: F27
status: in-progress
priority: medium
estimated_size: XS
depends_on: [F27-S01]
agent_id: frontend-engineer
source_docs:
  - docs/DESIGN_SYSTEM.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-13T15:36:12Z

---
# F27-S03 — Aplicar PageContainer (settings/forms) + verificação full-bleed

> **source_docs:** `docs/DESIGN_SYSTEM.md` (subseção "Largura de conteúdo", F27-S01); `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Envolver as **route shells de settings e do `pipeline/settings`** em `<PageContainer>` (default 1600px; o painel de settings é largo, então `default`, não `narrow`) e fazer a verificação final de que as 4 telas full-bleed seguem edge-to-edge após a F27 inteira. Fecha a fase de layout.

## Contexto

Consome F27-S01. As páginas de settings renderizam o `SettingsPanel` (sidebar 3 níveis + conteúdo) sem limite de largura → esticam no ultrawide. Disjunto de F27-S02 (lista/detalhe).

## Escopo (faz)

- Envolver em `<PageContainer>` (default) cada shell:
  - `apps/web/app/(app)/settings/page.tsx`
  - `apps/web/app/(app)/settings/calendar/page.tsx`
  - `apps/web/app/(app)/settings/channels/page.tsx`
  - `apps/web/app/(app)/settings/conversions/page.tsx`
  - `apps/web/app/(app)/pipeline/settings/page.tsx`
- Verificação (DoD, sem editar): confirmar no build/preview que `conversations`, `pipeline` (board), `flows/[id]` (canvas) e `calendar` permanecem full-bleed.

## Fora de escopo

- Telas de lista/detalhe (F27-S02). Telas full-bleed (não editar — só verificar). Internals de feature.

## Arquivos permitidos

- `apps/web/app/(app)/settings/page.tsx`
- `apps/web/app/(app)/settings/calendar/page.tsx`
- `apps/web/app/(app)/settings/channels/page.tsx`
- `apps/web/app/(app)/settings/conversions/page.tsx`
- `apps/web/app/(app)/pipeline/settings/page.tsx`

## Arquivos proibidos

- Tudo de F27-S02 (`apps/web/app/(app)/{page,agents,campaigns,contacts,conversions,knowledge,flows}/...`)
- Telas full-bleed: `conversations/**`, `pipeline/page.tsx`, `flows/[id]/**`, `calendar/**`
- `apps/web/features/**`

## Definition of Done

- [ ] As 5 shells de settings/pipeline-settings envolvem o conteúdo em `<PageContainer>` (centralizado/limitado a 1600px).
- [ ] Verificado: as 4 telas full-bleed seguem edge-to-edge (sem `max-width` herdado).
- [ ] Diff restrito a `app/(app)/settings/**` + `app/(app)/pipeline/settings/page.tsx`.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- **§1**: painel de settings centralizado, fim do esticamento. **§2.4**: nav/busca Cmd+K do painel (§ settings) intactas — container só limita largura.
- **§3.8** density preference do painel preservada.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Slot pequeno e mecânico; fecha a F27.
- **Paralelismo:** disjunto da F26 e da F27-S02 (rodam em paralelo após S01).
