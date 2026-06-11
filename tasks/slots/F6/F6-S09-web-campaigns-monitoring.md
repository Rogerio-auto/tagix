---
id: F6-S09
title: Frontend CampaignsPage + monitoring real-time + health badge
phase: F6
status: blocked
priority: high
estimated_size: M
depends_on: [F6-S03]
---
# F6-S09 — CampaignsPage + monitoring (web)

> **source_docs:** `docs/features/CAMPAIGNS.md` §11, §12.1, §12.6; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F6-S08
> **blocks:** —

## Objetivo
Lista de campanhas + painel de monitoramento: `CampaignsPage` (filtro por status, cards com KPIs, ações pausar/retomar/cancelar/duplicar) e o painel de detalhes com **big stats**, trend chart (granularidade 5min), **health badge** (healthy/warning/critical §11), alerts de Meta errors recentes e botão "Pausar". Refetch 30s.

## Escopo (faz)
- `apps/web/app/(app)/campaigns/**` (lista + detalhe; o `new`/`edit` é de F6-S08).
- `apps/web/features/campaigns/list/**` + `apps/web/features/campaigns/monitoring/**`: `CampaignsPage`, `CampaignCard` (KPIs + rate visual), `CampaignMonitor` (stats + trend + health badge + alerts), hooks `useCampaigns`/`useCampaignMetrics` (TanStack Query refetch 30s).
- Item de navegação "Campanhas" na Sidebar, gated por `can('campaign.list')`.

## Fora de escopo
- Editor/wizard (F6-S08), API (F6-S03).

## Arquivos permitidos
- `apps/web/app/(app)/campaigns/**`
- `apps/web/features/campaigns/list/**`
- `apps/web/features/campaigns/monitoring/**`
- `apps/web/shared/components/layout/Sidebar.tsx`

## Arquivos proibidos
- `apps/web/features/campaigns/editor/**` (dono: F6-S08)
- `apps/web/app/(app)/campaigns/new/**`, `.../[id]/edit/**` (donos: F6-S08)

## Definition of Done
- [ ] Lista com filtros + KPIs + ações (pausar/retomar/cancelar/duplicar); monitor com health badge + trend + alerts; refetch 30s.
- [ ] Nav gated por `can('campaign.list')`; ações gated (`campaign.pause`/`campaign.cancel`).
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2 nav 1ª classe; §2.7 skeleton; §3 health badge legível (cores semânticas DS v2, zero hex), alerts não-intrusivos, estados empty/error 3-partes.

## Permission scope
- Ver → `campaign.list`/`campaign.view_metrics`; pausar/retomar → `campaign.pause` (MANAGERS); cancelar → `campaign.cancel` (ADMINS).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Dono da Sidebar na F6 (F6-S08 não toca) — evita colisão.
