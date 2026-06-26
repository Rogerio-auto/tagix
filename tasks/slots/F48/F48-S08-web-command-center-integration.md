---
id: F48-S08
title: Integração Command Center — tiers, HeroCard, registry, types
phase: F48
status: done
priority: high
estimated_size: M
depends_on: [F48-S03, F48-S05, F48-S06, F48-S07]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 1 (hierarquia) — o que importa é grande e no topo; o resto desce e encolhe (command center)."
  - "Aplica 2.3 / 3.2 — drill em drawer lateral; nada de modal full-screen."
  - "Aplica 3.6 — SkeletonList/ChartSkeleton seguram a forma durante o load."
  - "Aplica 2.6 — tiers vazios não renderizam (sem seção fantasma); nunca zero enganoso."
  - "Aplica 8 (mobile) — tiers viram 1 coluna full-width; sem overflow; alvos adequados."
completed_at: 2026-06-26T01:30:14Z

---
# F48-S08 — Reestruturação do DashboardClient em tiers (Command Center)

## Objetivo

Reorganizar a home do dashboard de "grade por categoria" para um **command center em tiers** (Hero
KPIs → Tendências/série → Leaderboards → Leads recentes + métricas secundárias), criar o `HeroCard`
e ligar os 3 widgets novos no registry por `cardType`. Mantém 100% server-driven, customização,
drill e socket.

## Contexto

Slot de integração: é o único dono dos arquivos de "costura" do dashboard (types/registry/client).
Depende dos widgets (S05/S06/S07 — arquivos existem) e do backend (S03 — payload manda os cards novos).

## Escopo (faz)

- `types.ts`: `CardType` += `'leaderboard' | 'feed' | 'timeseries'`.
- `cards/registry.tsx`: mapear os 3 novos cardTypes → componentes (timeseries via `lazyClient` com
  `ChartSkeleton`, como o `ChartCard`; leaderboard/feed importados normalmente).
- `cards/HeroCard.tsx` (novo): variante grande do StatCard para os KPIs de destaque — número em
  `font-price` maior, ícone, label; **um** card pode receber acento neon (regra DS "1 verde por
  tela"). Reusar `displayValue`/`metricIcon`/`format` (não duplicar lógica de StatCard; extrair se
  necessário mantendo StatCard funcionando).
- `presentation.ts` (novo): função pura `buildTiers(cards)` que classifica a lista (já filtrada +
  ordenada por `applyLayout`) em `{ hero, charts, timeseries, leaderboards, feeds, secondary }`.
  Hero = conjunto curado e **ordenado** de keys (ex.: `valor_convertido_workspace_mes`,
  `valor_total_pipeline`, `deals_fechados_ganho_mes`, `conversoes_workspace_mes`; AGENT:
  `minhas_conversas_abertas`, `minha_fila_pendente`, `resolvidas_hoje_por_mim`,
  `conversoes_minhas_mes`) — só promove as que chegaram (role-safe), cap ~4; o resto desce.
- `presentation.test.ts` (novo): classificação, ordem do hero, fallback quando keys ausentes,
  cards ocultos respeitados.
- `DashboardClient.tsx`: trocar o `grouped.map` por render dos tiers:
  1. Hero strip (grade `grid-cols-2 lg:grid-cols-4`, HeroCard).
  2. Tendências: `chart` + `timeseries` em `lg:grid-cols-2` (larguras maiores).
  3. Leaderboards: `leaderboard` (+ tabelas de ranking) em `xl:grid-cols-2`.
  4. Leads recentes (`feed`) + métricas secundárias (`stat` restantes) em grade compacta.
  - Manter: `AlertsBanner`, `SetupChecklist`, `CustomizeDashboardButton`, `applyLayout`,
    `DrillDownDrawer`, `useDashboardSocket`, `DRAWER_METRICS` (adicionar `leaderboard_produtividade`
    se abrir drawer). Tiers vazios não renderizam.

## Fora de escopo

- Implementar os widgets (S05/S06/S07). Backend (S01/S02/S03). Seletor de período funcional (segue
  follow-up — exige suporte no `/dashboard/me`). Refatorar a ChatList para usar `<Avatar>`.

## Arquivos permitidos

- `apps/web/features/dashboard/types.ts`
- `apps/web/features/dashboard/cards/registry.tsx`
- `apps/web/features/dashboard/cards/HeroCard.tsx` (novo)
- `apps/web/features/dashboard/presentation.ts` (novo)
- `apps/web/features/dashboard/presentation.test.ts` (novo)
- `apps/web/features/dashboard/DashboardClient.tsx`

## Arquivos proibidos

- `cards/LeaderboardCard.tsx` (S05), `cards/RecentLeadsCard.tsx` (S06), `cards/TimeSeriesCard.tsx` (S07)
- `cards/StatCard.tsx` (não reescrever; só extrair helper compartilhado se preciso — preferir importar)
- backend (`apps/api/**`), `packages/**`

## Contratos de entrada

- Payload `GET /dashboard/me` já inclui (S03) cards `cardType` `leaderboard`/`feed`/`timeseries`.

## Definition of Done

- [ ] Dashboard renderiza em tiers com hierarquia clara (hero no topo, secundário compacto embaixo).
- [ ] Os 3 cardTypes novos renderizam via registry; timeseries é lazy (fora do First Load JS).
- [ ] HeroCard grande, com no máximo 1 acento neon; demais sóbrios.
- [ ] `buildTiers` é pura e coberta por `presentation.test.ts` (ordem hero + fallback + ocultos).
- [ ] Customização (esconder/reordenar), drawer, socket e alerts seguem funcionando.
- [ ] Tiers vazios não renderizam; mobile vira 1 coluna sem overflow.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` + teste do presentation verdes.

## Permission scope

- Nenhuma decisão de visibilidade no front (server-driven). Hero apenas reordena/destaca o que o
  servidor já autorizou — nunca revela card de role não autorizado (DASHBOARD §10).

## UX considerations

- 1 (hierarquia command center), 2.3/3.2 (drawer), 3.6 (skeleton), 2.6 (sem seção fantasma), 8 (mobile).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
pnpm --filter @hm/web test
```

## Notas

- e2e Playwright não roda verde neste host (memória `e2e-no-hydration-this-host`) — validar por
  typecheck/lint/build/unit.
- `HeroCard` deve reusar a lógica de `StatCard` (displayValue/metricIcon). Se extrair um helper,
  colocar dentro do `files_allowed` (ex.: dentro do próprio HeroCard ou import do StatCard sem editá-lo).
- Acento neon: usar tokens (`--glow-active`/`border-brand`), respeitando "1 verde por tela".
