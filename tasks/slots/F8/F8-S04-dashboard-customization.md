---
id: F8-S04
title: Dashboard customização — layout pessoal (hide/reorder/período) + cards obrigatórios (admin)
phase: F8
status: review
priority: medium
estimated_size: M
depends_on: [F8-S02, F8-S03, F8-S05]
agent_id: backend-engineer
claimed_at: 2026-06-11T20:29:15Z
completed_at: 2026-06-11T20:33:28Z

---
# F8-S04 — Dashboard customização

> **source_docs:** `docs/features/DASHBOARD.md` §6, §7, §8; `docs/ROADMAP.md` F8-S07
> **blocks:** —

## Objetivo
Customização do dashboard: cada member esconde/reordena cards (drag) e define período padrão — persistido em `members.dashboard_layout` via `PATCH /api/members/me/dashboard-layout`; e o ADMIN define **cards obrigatórios** por role em `/settings/dashboard` (member não pode esconder os obrigatórios, nem adicionar métrica fora do seu role).

## Escopo (faz)
- `apps/api/src/routes/members/dashboard-layout.ts`: `PATCH /api/members/me/dashboard-layout` (valida contra os cards permitidos do role); leitura dos obrigatórios do workspace.
- `apps/web/features/dashboard/customization/**`: modo de edição (hide/show/reorder/período) no DashboardClient.
- `apps/web/features/settings/sections/dashboard/**`: seção `/settings/dashboard` (ADMIN define obrigatórios + limites de SLA/alerta §7).

## Fora de escopo
- Métricas (F8-S02), shell do dashboard (F8-S03), shell do settings (F8-S05).

## Arquivos permitidos
- `apps/api/src/routes/members/dashboard-layout.ts`
- `apps/web/features/dashboard/customization/**`
- `apps/web/features/settings/sections/dashboard/**`

## Permission scope
- Layout pessoal → qualquer member (só o seu). Cards obrigatórios + limites SLA/alerta → ADMIN (`/settings/dashboard`).

## Definition of Done
- [ ] Member esconde/reordena cards + define período (persiste); não consegue esconder obrigatórios nem adicionar métrica fora do role.
- [ ] ADMIN define obrigatórios + limites de SLA/alerta que alimentam os alertas do dashboard.
- [ ] `pnpm --filter @hm/api test` + `pnpm --filter @hm/web build` + lint/typecheck verdes.

## UX considerations
- §3 drag-reorder suave (sem overlap de texto); §6 obrigatórios marcados visualmente como não-removíveis; tokens DS v2.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Monta a seção `/settings/dashboard` dentro do shell de F8-S05 (subdir próprio, sem colidir). Limites de SLA usam a config de F8-S01.
