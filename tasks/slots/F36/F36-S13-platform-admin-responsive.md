---
id: F36-S13
title: Platform admin legível/operável no mobile
phase: F36
status: in-progress
priority: low
estimated_size: M
depends_on:
  - F36-S01
  - F36-S05
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T02:13:32Z

---
# F36-S13 — Platform admin responsivo

## Objetivo

Tornar o painel de plataforma (super-admin) **legível e operável** no celular (D3 — não paridade total): home, usage, models, policies, secrets, tenants(+detalhe), plans, subscriptions, impersonation, playground.

## Contexto

Tabelas + editores, uso majoritariamente desktop. Meta: nada quebrado/ilegível no toque, sem reinventar cada editor. Consome `ResponsiveTable` (S05) + `Sheet` (S01).

## Escopo (faz)

- **`apps/web/features/platform-admin/**`** + **`apps/web/app/(platform)/**`** — `< md`: `PlatformShell` com nav mobile; listas (tenants, plans, subscriptions, models) via `ResponsiveTable`/cards; editores (policies/secrets/subscription) em coluna com save fixo; Workspace360/playground empilhados e roláveis. `md+`: inalterado.

## Fora de escopo

- Mudança de APIs de plataforma. Polimento fino de UX (só legível/operável).

## Arquivos permitidos

- `apps/web/features/platform-admin/**`
- `apps/web/app/(platform)/**`

## Arquivos proibidos

- `apps/api/**`, `packages/**`, `apps/web/features/!(platform-admin)/**`

## Definition of Done

- [ ] `< md`: todas as telas de plataforma legíveis e operáveis (sem scroll-x quebrado, alvos tocáveis).
- [ ] `md+`: inalterado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.6 estados; §2.3 sheets/editores; alvos ≥44px. Prioridade de polish menor (admin), mas sem quebra.

## Notas

Reusar `ResponsiveTable` (S05). O `PlatformShell` já tem alguns breakpoints — estender, não reescrever.
