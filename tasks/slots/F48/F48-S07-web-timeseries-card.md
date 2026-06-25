---
id: F48-S07
title: Widget TimeSeriesCard (desempenho 30d, linha com toggle)
phase: F48
status: done
priority: medium
estimated_size: S
depends_on: []
blocks: [F48-S08]
agent_id: frontend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 3.6 — ChartSkeleton segura a forma do card enquanto o chunk recharts baixa."
  - "Aplica 2.6 — sem dados na janela mostra mensagem clara, não eixo vazio confuso."
  - "Aplica 3.5 — toggle de série com estados de hover/seleção claros."
  - "Aplica 8 (mobile) — altura por breakpoint, ResponsiveContainer 100% largura, sem estourar viewport."
completed_at: 2026-06-25T22:53:01Z

---
# F48-S07 — Widget TimeSeriesCard

## Objetivo

Criar o componente `TimeSeriesCard` que plota a **série de 30 dias** de desempenho (resolvidas /
conversões / novos contatos) como gráfico de linha, com um toggle para alternar a série exibida.
Consome `card.value.series` do `desempenho_30d`.

## Contexto

Arquivo novo autocontido em `cards/`. Dormente até o S08 mapeá-lo no registry por
`cardType: 'timeseries'`. recharts já é usado pelo `ChartCard` (lazy) — seguir o mesmo padrão de
import sob demanda quando o S08 registrar (aqui o componente pode importar recharts diretamente;
o S08 o carrega via `lazyClient` no registry, tirando-o do First Load JS).

## Escopo (faz)

- `apps/web/features/dashboard/cards/TimeSeriesCard.tsx` (novo): props `{ card; onDrill? }`.
  - Parser local `readSeries(value)` → `{ series: [{ day, resolvidas, conversoes, conversoes_valor_cents, novos_contatos }] }`.
  - Toggle (3 opções): Resolvidas | Conversões | Novos contatos. Estado local de qual série mostrar.
  - `LineChart` (recharts) com `ResponsiveContainer`, eixos com tokens (`var(--text-low)`,
    `var(--border)`), linha em `var(--brand)`, tooltip estilizado (espelhar o `ChartCard`).
  - Eixo X = dia (formato curto dd/MM). Altura por breakpoint (ex.: h-56 / sm:h-52).
  - Estado vazio: "Sem dados no período."; clicável → `onDrill` (opcional).
  - Tokens DS, zero hex.

## Fora de escopo

- Registry / tipos / DashboardClient (S08). Backend (S02/S03). Outros widgets (S05/S06).

## Arquivos permitidos

- `apps/web/features/dashboard/cards/TimeSeriesCard.tsx` (novo)

## Arquivos proibidos

- `cards/registry.tsx` (S08), `types.ts` (S08), `DashboardClient.tsx` (S08)
- `cards/LeaderboardCard.tsx` (S05), `cards/RecentLeadsCard.tsx` (S06)

## Contratos de entrada

- `card.value = { series: [{ day:string(ISO date), resolvidas:number, conversoes:number, conversoes_valor_cents:number, novos_contatos:number }] }`.

## Definition of Done

- [ ] Gráfico de linha 30d com toggle entre as 3 séries; eixos/cores via tokens.
- [ ] Estado vazio claro; ResponsiveContainer (sem overflow no mobile).
- [ ] Sem `any`; parser tolerante a value malformado.
- [ ] DS v2 sem hex; `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- 3.6 (skeleton/forma), 2.6 (vazio claro), 3.5 (toggle com estados), 8 (mobile responsivo).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Importa `DashboardCard` de `../types` (existe — não editar). recharts já está nas deps do @hm/web.
- O S08 registra este componente via `lazyClient(..., { ssr:false, loading: ChartSkeleton })` como o
  `ChartCard` faz — não precisa de `next/dynamic` aqui dentro.
