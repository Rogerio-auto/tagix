---
id: F36-S08
title: Agentes responsivos — lista + detalhe com abas
phase: F36
status: blocked
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
---
# F36-S08 — Agentes responsivos

## Objetivo

Tornar a lista de agentes e o detalhe (abas config/tools/metrics/playground/knowledge) usáveis no celular.

## Contexto

Lista em cards/grid; detalhe com abas e o wizard de criação. Consome `Sheet`/`useBreakpoint` (S01) e o padrão de abas roláveis.

## Escopo (faz)

- **`apps/web/features/agents/**`** + **`apps/web/app/(app)/agents/**`** — `< md`: lista em 1 coluna; detalhe com **abas roláveis** (scroll-x ou segmented), conteúdo empilhado, ações no rodapé; playground/metrics responsivos; wizard de criação com 1 grupo por view + CTA fixo no rodapé (já é step-based). `md+`: inalterado.

## Fora de escopo

- Mudança de API de agentes. Lógica do AgentSelector do cockpit (S03).

## Arquivos permitidos

- `apps/web/features/agents/**`
- `apps/web/app/(app)/agents/**`

## Arquivos proibidos

- `apps/web/features/conversations/**`, `apps/api/**`, `packages/**`

## Definition of Done

- [ ] `< md`: lista, detalhe (abas roláveis + conteúdo empilhado) e wizard usáveis no toque; ações no rodapé.
- [ ] `md+`: inalterado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.8 wizard (CTA fixo, autosave entre steps); §2.3 sheets; alvos ≥44px; §2.6 estados.

## Notas

A config de departamentos do agente (F34-S02) já existe — garantir que o multi-select/toggles ficam bons no toque.
