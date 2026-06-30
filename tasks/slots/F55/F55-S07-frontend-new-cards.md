---
id: F55-S07
title: Frontend — cards novos Placar IA×Humano, ROI da IA, Funil de pipeline
phase: F55
status: done
priority: medium
estimated_size: M
depends_on: [F55-S06, F55-S05]
blocks: [F55-S09]
agent_id: frontend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica §2.4 — Placar IA×Humano comunica o vencedor de relance (lado a lado, rótulos claros)."
  - "Aplica §3.10 — animação curta/proposital na barra do funil e na transição de valores."
  - "Aplica §2.6/§3.6 — empty/loading dedicados (sem conversão configurada / sem deals)."
completed_at: 2026-06-29T23:39:23Z

---
# F55-S07 — Frontend: cards novos de Negócio

## Objetivo

Implementar os componentes visuais dos 3 cards novos servidos por S05, no padrão de clareza do S06:
**Placar IA × Humano** (comparativo lado a lado), **ROI da IA** (stat com receita÷custo) e **Funil de
pipeline** (barras horizontais por estágio).

## Contexto

S05 entrega as keys `placar_ia_humano`, `roi_ia`, `funil_pipeline` no payload `/api/dashboard/me` (filtradas
por role). S06 entrega o shell por seções + registry de cards. Este slot só adiciona os componentes e os
registra no `cards/registry.tsx` (mapeando o `cardType` que S05 definiu).

## Escopo

### files_allowed
- `apps/web/features/dashboard/cards/PlacarIaHumanoCard.tsx` (NOVO)
- `apps/web/features/dashboard/cards/RoiIaCard.tsx` (NOVO)
- `apps/web/features/dashboard/cards/FunilPipelineCard.tsx` (NOVO)
- `apps/web/features/dashboard/cards/registry.tsx` (registrar os 3 — owned por S06, sequencial)
- `apps/web/features/dashboard/sections.ts` (posicionar na seção Negócio, se necessário — sequencial após S06)
- `apps/web/features/dashboard/cards/__tests__/**`

### files_forbidden
- `apps/api/**`, `packages/**`, demais arquivos de `features/dashboard/**` não listados

## Escopo (faz)
- **PlacarIaHumanoCard:** duas colunas (IA vs Humano) com conversões + receita do mês; realce do líder;
  barra de proporção; rótulos explícitos ("Atribuído à IA" / "Atribuído à equipe"). Lê o shape de S05.
- **RoiIaCard:** stat grande do ROI (ex.: "3,2×") + subtexto "R$ X receita ÷ US$ Y custo"; estado neutro
  quando `null` (custo 0) — não renderiza número enganoso.
- **FunilPipelineCard:** barras horizontais por estágio (valor aberto), ordenadas por `position`; mostra win
  rate e ciclo médio como contexto. Clique → drill drawer (`/pipeline`).
- Registrar os 3 no `REGISTRY` de `cards/registry.tsx` pelo `cardType` de S05; lazy-load se usarem recharts.
- Tokens semânticos, zero hex; "1 verde por tela" continua sendo do KPI primário (estes não roubam o acento).

## Fora de escopo
- Backend/queries (S05). Shell/seções base (S06). Endpoints.

## Contratos de entrada
- `card.value` para cada key conforme S05 (Placar: `{ ia, humano }`; ROI: `{ receitaCents, custoUsd, roi|null }`; Funil: linhas por estágio).

## Definition of Done
- [ ] 3 componentes renderizam os shapes de S05 e estão registrados por cardType.
- [ ] Placar comunica o líder de relance; ROI trata `null`; Funil ordena por estágio + drill.
- [ ] Empty/loading/skeleton; responsivo; zero hex; checklist UX relevante marcado.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter @hm/web test`, build do web verdes.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
pnpm --filter @hm/web build
```

## Notas
Sequencial após S06 (compartilham `registry.tsx`/`sections.ts`) e depende do contrato de S05. Se S05
introduziu `cardType: 'scoreboard'`, mapear aqui; senão reusar `chart`/`table` com layout dedicado.
