---
id: F48-S06
title: Widget RecentLeadsCard (lista estilo chatlist, atividade recente)
phase: F48
status: blocked
priority: medium
estimated_size: S
depends_on: [F48-S04]
blocks: [F48-S08]
agent_id: frontend-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 3.9 — feed de atividade recente (timeline) com horário relativo legível."
  - "Aplica 3.6 — skeleton/forma estável; sem foto cai em iniciais (via <Avatar>)."
  - "Aplica 2.6 — vazio convida ('nenhum lead ativo ainda'), com CTA para Contatos."
  - "Aplica 8 (mobile) — linhas alvo ≥44px, avatar 40px, preview truncado sem overflow."
---

# F48-S06 — Widget RecentLeadsCard

## Objetivo

Criar o componente `RecentLeadsCard`: lista de **leads recentes por atividade** no estilo da ChatList
— avatar (foto via `<Avatar>`), nome, canal, preview da última mensagem e horário. Cada item navega
para o contato/conversa. Consome `card.value.rows` do `leads_recentes`.

## Contexto

Arquivo novo autocontido em `cards/`. Dormente até o S08 mapeá-lo no registry por `cardType: 'feed'`.
Reaproveita a linguagem visual da ChatList (avatar + nome + preview + hora) que o Rogério citou.

## Escopo (faz)

- `apps/web/features/dashboard/cards/RecentLeadsCard.tsx` (novo): props `{ card; onDrill? }`.
  - Parser local `readLeads(value)` → `{ rows: [{ contactId, nome, avatarUrl, canal, lastActivityAt, preview }] }`.
  - Layout: lista (top ~6). Cada linha é um `Link` para `/contacts?focus=${contactId}` (ou
    `/conversations` se fizer mais sentido): `<Avatar size="md">`, nome (truncate) + badge de canal,
    preview truncado em `text-text-low`, hora relativa à direita.
  - Hover/focus state (3.5); estado vazio convida com CTA "Ver contatos".
  - Tokens DS, zero hex. Hora relativa com util local (reusar padrão de `shortTime` da ChatList, mas
    sem importar de conversations — manter o card autocontido).

## Fora de escopo

- Registry / tipos / DashboardClient (S08). Backend (S02/S03). Outros widgets (S05/S07).

## Arquivos permitidos

- `apps/web/features/dashboard/cards/RecentLeadsCard.tsx` (novo)

## Arquivos proibidos

- `cards/registry.tsx` (S08), `types.ts` (S08), `DashboardClient.tsx` (S08)
- `cards/LeaderboardCard.tsx` (S05), `cards/TimeSeriesCard.tsx` (S07)

## Contratos de entrada

- `card.value = { rows: [{ contactId:string, nome:string, avatarUrl:string|null, canal:string, lastActivityAt:string(ISO), preview:string|null }] }`.

## Definition of Done

- [ ] Lista estilo chatlist com foto (fallback iniciais), nome, canal, preview e hora relativa.
- [ ] Cada item navega (Link) para o contato/conversa; hover/focus visíveis.
- [ ] Estado vazio convida com CTA; sem `any`; parser tolerante.
- [ ] DS v2 sem hex; mobile sem overflow.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- 3.9 (timeline/feed), 3.6 (forma estável), 2.6 (empty convida + CTA), 3.5 (hover), 8 (mobile).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Importa `<Avatar>` de `@hm/ui` (S04) e `DashboardCard` de `../types` (existe — não editar).
- Não importar de `features/conversations/**` (mantém o card desacoplado e o `files_allowed` limpo).
