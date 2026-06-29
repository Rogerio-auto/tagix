---
id: F55-S06
title: Frontend — shell novo por seções + cards redesenhados (clareza Stripe/Datacrazy)
phase: F55
status: available
priority: high
estimated_size: L
depends_on: [F55-S04]
blocks: [F55-S07, F55-S09]
agent_id: frontend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
  - docs/MOBILE_UX.md
ux_considerations:
  - "Aplica §3.2/§2.3 — drill em drawer/Sheet lateral, nunca modal full-screen."
  - "Aplica §2.6 — empty state por seção com CTA (ex.: sem conversões → 'Configure um tipo de conversão')."
  - "Aplica §2.7/§3.6 — skeleton por card no load (sem tela branca, sem spinner solto)."
  - "Aplica §2.4 — cada KPI tem label explícito + unidade; nada de número solto sem contexto."
  - "Aplica §8 — mobile: grid colapsa para 1 coluna, drawer vira bottom-sheet (useBreakpoint)."
---
# F55-S06 — Frontend: shell por seções + redesign (clareza)

## Objetivo

Reconstruir a camada visual do dashboard com **hierarquia clara de informação** no padrão Stripe/Datacrazy
(feedback direto do founder: "não está claro as informações contidas"). Trocar os 6 tiers atuais por
**seções semânticas** legíveis, e redesenhar os cards existentes para que cada número seja imediatamente
compreensível (rótulo + unidade + contexto/variação).

## Contexto

Contrato `/api/dashboard/me` está **congelado e estável** desde S04 (server-driven role-aware: cards já
filtrados por papel; o front NUNCA faz `if(role)`). Hoje `presentation.ts:buildTiers` classifica em 6 tiers
e `cards/registry.tsx` mapeia cardType→componente. O founder quer mais clareza: blocos bem rotulados,
tipografia editorial, número grande legível, comparação/contexto visível, menos ruído.

## Escopo

### files_allowed
- `apps/web/app/(app)/page.tsx`
- `apps/web/features/dashboard/DashboardClient.tsx`
- `apps/web/features/dashboard/sections.ts` (NOVO — substitui `presentation.ts`)
- `apps/web/features/dashboard/sections.test.ts` (NOVO — porta `presentation.test.ts`)
- `apps/web/features/dashboard/presentation.ts` (remover/aposentar)
- `apps/web/features/dashboard/presentation.test.ts` (remover/aposentar)
- `apps/web/features/dashboard/types.ts`, `format.ts`, `index.ts`, `queries.ts`, `useDashboardSocket.ts`
- `apps/web/features/dashboard/cards/StatCard.tsx`, `HeroCard.tsx`, `CsatCard.tsx`, `ChartCard.tsx`, `TimeSeriesCard.tsx`, `LeaderboardCard.tsx`, `RecentLeadsCard.tsx`, `TableCard.tsx`, `registry.tsx`
- `apps/web/features/dashboard/DrillDownDrawer.tsx`, `AlertsBanner.tsx`

### files_forbidden
- `apps/web/features/dashboard/cards/PlacarIaHumanoCard.tsx`, `RoiIaCard.tsx`, `FunilPipelineCard.tsx` (NOVOS — são S07)
- `apps/web/features/dashboard/customization/**` (reuso sem alteração; se precisar, vira sub-slot)
- `apps/api/**`, `packages/**`

## Escopo (faz)
- **Layout macro travado (founder): "Stripe — coluna editorial".** Estrutura vertical calma, leitura de cima
  pra baixo, muito respiro: **(1) faixa de KPIs grandes no topo** (poucos números que importam, com delta/
  variação) → **(2) gráfico largo** (Desempenho 30d, full-width) → **(3) tabelas/rankings** empilhados. NÃO
  é grid denso de tiles (Datacrazy foi descartado); foco em clareza executiva, não em densidade.
- `sections.ts`: `buildSections(cards)` agrupa por seção do modelo (Atendimento/"Minha mesa" · Operação ·
  Negócio) refletindo a ordem editorial acima: **KPIs no topo** → gráficos/série largos → rankings/tabelas →
  feeds. Mais legível e extensível que os 6 tiers. Manter pureza testável.
- Redesign visual (Stripe/Datacrazy, dark-first):
  - KPI: número grande (`font-price`) + **label claro** + unidade + **delta/contexto** quando houver (ex.: vs período anterior). Nada de número órfão.
  - Cards com respiro (espaçamento generoso), divisão visual por seção com título + `?` HelpHint.
  - Hierarquia por peso/tamanho, **não** por cor; regra "1 verde neon por tela" (só o KPI primário).
  - Gráficos recharts com eixos/cores via tokens; tooltips legíveis.
  - Tokens semânticos de `@hm/design-tokens`/`theme.css` — **zero hex** em JSX.
- Estados: empty por seção (CTA), loading (skeleton por card), error (3 partes — o quê/por quê/o que fazer).
- Mobile: grid 1 coluna, drawer→bottom-sheet (`useBreakpoint().isMobile`).
- Manter realtime (`useDashboardSocket` invalida no `dashboard:metric_changed`) e customização (reusar `CustomizeDashboardDrawer` via contrato existente).

## Fora de escopo
- 3 cards NOVOS (PlacarIaHumano/RoiIa/FunilPipeline) — componentes são S07.
- Alterar contrato/endpoints (S04 congelou). Backend de qualquer tipo.

## Contratos de entrada
- Consome `/api/dashboard/me` (cards/alerts/layoutPreferences) e `/metrics/:key` (drill) — shape de S04.

## Permission scope
Nenhum `if(role)` no client — visibilidade é server-side. READONLY vê os mesmos cards informativos sem ações.

## Definition of Done
- [ ] `buildSections` substitui `buildTiers`; layout por seções com hierarquia clara.
- [ ] Cada KPI legível: label + unidade + contexto; "1 verde por tela" respeitado; zero hex em JSX.
- [ ] Drill em drawer/Sheet (desktop) e bottom-sheet (mobile); empty/loading/error por seção.
- [ ] Checklist UX (`UX_PRINCIPLES.md §4`) relevante marcado; responsivo (1 coluna no mobile).
- [ ] `pnpm typecheck`, `pnpm lint` (zero `any`), `pnpm --filter @hm/web test` verdes; build do web verde.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
pnpm --filter @hm/web build
```

## Notas
A suíte Playwright não hidrata no Windows local (memória `e2e-no-hydration-this-host`) — validar por
typecheck/lint/unit/build + verificação manual. Referência visual: Stripe (cards limpos, número claro,
sparkline de contexto) + Datacrazy (faixa de KPIs + leaderboard). Clareza > densidade > decoração.
