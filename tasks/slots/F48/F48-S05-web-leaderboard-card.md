---
id: F48-S05
title: Widget LeaderboardCard (pódio com foto, produtividade)
phase: F48
status: done
priority: medium
estimated_size: S
depends_on: [F48-S04]
blocks: [F48-S08]
agent_id: frontend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.3 / 3.2 — clicar abre drawer lateral de detalhe, nunca modal full-screen."
  - "Aplica 3.6 — skeleton/forma estável enquanto carrega; sem foto cai em iniciais (via <Avatar>)."
  - "Aplica 2.6 — estado vazio convida ('sem atividade no período'), não zero enganoso."
  - "Aplica 8 (mobile) — card full-width, linhas com alvo ≥44px, sem overflow horizontal."
completed_at: 2026-06-25T23:25:33Z

---
# F48-S05 — Widget LeaderboardCard

## Objetivo

Criar o componente `LeaderboardCard` que renderiza o ranking de **produtividade** dos atendentes
como pódio: avatar (foto via `<Avatar>`), nome, métrica em destaque (resolvidas) e secundárias
(abertas, tempo médio), com realce do 1º colocado. Consome `card.value.rows` do `leaderboard_produtividade`.

## Contexto

Arquivo novo e autocontido em `cards/`. Fica dormente até o S08 mapeá-lo no registry por
`cardType: 'leaderboard'`. Define seu próprio parser do `value` (defensivo, sem `any`).

## Escopo (faz)

- `apps/web/features/dashboard/cards/LeaderboardCard.tsx` (novo): props `{ card: DashboardCard;
  onDrill?: (card) => void }` (mesma assinatura dos outros cards).
  - Parser local `readLeaderboard(value)` → `{ rows: [{ memberId, nome, avatarUrl, resolvidas,
    abertas, tmr_seg }] }` (lê `card.value` com narrowing seguro; tolera campos ausentes).
  - Layout: lista vertical (top ~5). Cada linha: posição (1/2/3 com leve destaque), `<Avatar size="sm">`,
    nome (truncate), e à direita o número de resolvidas em `font-price` + sub-linha "abertas · tmr".
  - 1º lugar com realce sutil (`bg-brand-faint/40` ou borda) — um destaque, sem exagero neon.
  - Clicável → `onDrill(card)` (drawer). Estados: vazio ("sem atividade no período"), erro tolerado.
  - Tokens DS, zero hex; reusar `formatInt`/`formatDuration` de `../format`.

## Fora de escopo

- Registrar no registry / tipos / DashboardClient (S08). Backend (S02/S03). Abas de outros critérios.

## Arquivos permitidos

- `apps/web/features/dashboard/cards/LeaderboardCard.tsx` (novo)

## Arquivos proibidos

- `apps/web/features/dashboard/cards/registry.tsx` (S08), `types.ts` (S08), `DashboardClient.tsx` (S08)
- `apps/web/features/dashboard/cards/RecentLeadsCard.tsx` (S06), `TimeSeriesCard.tsx` (S07)

## Contratos de entrada

- `card.value = { rows: [{ memberId:string, nome:string, avatarUrl:string|null, resolvidas:number, abertas:number, tmr_seg:number|null }] }` (do S02/S03).

## Definition of Done

- [ ] Renderiza o pódio com foto (fallback iniciais via `<Avatar>`), nome e métricas.
- [ ] 1º colocado realçado; clique chama `onDrill`; estado vazio convida.
- [ ] Sem `any`; parser tolerante a value malformado (não quebra a tela).
- [ ] DS v2 sem hex; mobile sem overflow.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- 2.3/3.2 (drawer, não modal), 3.6 (forma estável/fallback), 2.6 (empty convida), 8 (mobile).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Importa `<Avatar>` de `@hm/ui` (S04). Importa `DashboardCard` de `../types` (já existe — não editar).
- Espelhar a estrutura visual/props dos cards atuais (`StatCard`/`TableCard`) para consistência.
