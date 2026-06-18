---
id: F36-S09
title: Campanhas responsivas — lista + wizard + monitoring
phase: F36
status: done
priority: medium
estimated_size: M
depends_on:
  - F36-S01
  - F36-S05
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T01:47:38Z
completed_at: 2026-06-18T01:53:12Z

---
# F36-S09 — Campanhas responsivas

## Objetivo

Lista de campanhas, wizard (nova/edit) e detalhe (monitoring + métricas) usáveis no celular.

## Contexto

Lista (tabela/cards), wizard multi-step, e monitoring com métricas/deliveries. Consome `ResponsiveTable` (S05) + `Sheet` (S01).

## Escopo (faz)

- **`apps/web/features/campaigns/**`** + **`apps/web/app/(app)/campaigns/**`** — `< md`: lista via `ResponsiveTable` (cards + filtros em sheet); wizard com 1 grupo por view + CTA fixo no rodapé + autosave entre steps; detalhe/monitoring em coluna única, métricas full-width, deliveries via cards. `md+`: inalterado.

## Fora de escopo

- Mudança de API de campanhas.

## Arquivos permitidos

- `apps/web/features/campaigns/**`
- `apps/web/app/(app)/campaigns/**`

## Arquivos proibidos

- `apps/web/shared/components/ResponsiveTable/**` (consome de S05), `apps/api/**`, `packages/**`

## Definition of Done

- [ ] `< md`: lista (cards+filtros sheet), wizard (CTA rodapé, autosave) e monitoring usáveis.
- [ ] `md+`: inalterado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.8 wizard; §2.6 estados; §2.3 sheets; §3.9 timeline no monitoring.

## Notas

Reusar o `ResponsiveTable` de S05 (não recriar). Compliance/opt-out continua igual — só layout.
