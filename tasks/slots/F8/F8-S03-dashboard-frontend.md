---
id: F8-S03
title: Dashboard frontend — DashboardClient + card registry (5 layouts role-aware) + alerts + drill-down
phase: F8
status: in-progress
priority: high
estimated_size: L
depends_on: [F8-S02]
agent_id: backend-engineer
claimed_at: 2026-06-11T19:34:19Z

---
# F8-S03 — Dashboard frontend

> **source_docs:** `docs/features/DASHBOARD.md` §3, §4, §9, §10; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F8-S02–S05
> **blocks:** F8-S04

## Objetivo
Substituir o placeholder do dashboard (`/`) pela tela role-aware real: Server Component carrega o snapshot inicial (`GET /dashboard/me`), `DashboardClient` hidrata + escuta socket, e renderiza os cards via **registry por tipo** (o servidor decide QUAIS cards vêm — o front nunca esconde com `if(role)`). Cards são links de drill-down (navegação filtrada ou drawer lateral — modal full-screen proibido §4). Alerts no topo.

## Escopo (faz)
- `apps/web/app/(app)/page.tsx`: Server Component que chama `loadDashboard()` (SSR) + monta `DashboardClient`.
- `apps/web/features/dashboard/**`: `DashboardClient`, `CardGrid`, registry de cards (stat card, ranking table, funnel, trend chart, alert), `useDashboardSocket` (invalida queries), `DrillDownDrawer`, server loader.
- Os 5 layouts (AGENT/SUPERVISOR/ADMIN/OWNER/READONLY) emergem dos cards que o servidor manda — sem ramificação por role no JSX.

## Fora de escopo
- Métricas/API (F8-S02), customização pessoal (F8-S04), settings.

## Arquivos permitidos
- `apps/web/app/(app)/page.tsx`
- `apps/web/features/dashboard/**`

## Definition of Done
- [ ] Dashboard renderiza cards do `GET /dashboard/me` por tipo; drill-down navega filtrado ou abre drawer (sem modal full-screen); alerts no topo; realtime invalida via socket.
- [ ] Nenhum `if (role !== ...)` escondendo card no JSX (server-driven).
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2.3 drill-down em drawer/navegação (modal full-screen PROIBIDO); §3 card sempre com destino (número sem ação = ruído §4); AGENT sem chart pesado (§10); §2.7 skeleton; tokens DS v2 (zero hex), cores semânticas em alerts/health.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Substitui o placeholder atual de `app/(app)/page.tsx` ("As métricas aparecem aqui"). Charts via lib leve (recharts ou similar) — adicionar via pnpm se faltar. Slot L — se passar de ~500 linhas, separe a card-library do shell.
