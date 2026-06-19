---
id: F42-S08
title: Plataforma assistida — botão "gerar cobrança" no Workspace 360 (UI)
phase: F42
status: blocked
priority: medium
estimated_size: S
depends_on: [F42-S07]
blocks: [F42-S09]
agent_id: frontend-engineer
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
  - docs/UX_PRINCIPLES.md
---

# F42-S08 — Cobrança assistida (UI Workspace 360)

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §7; `docs/UX_PRINCIPLES.md`
> **blocks:** F42-S09

## Objetivo

No Workspace 360 da plataforma, permitir ao super-admin gerar um link de cobrança/checkout para o
tenant (chama o endpoint do F42-S07) e copiar/abrir o link. DS v2 dark-first.

## Contexto

Consome a API do F42-S07. Vive na superfície de platform-admin já existente (tenants/Workspace360).

## Escopo (faz)

- Ação "Gerar cobrança" no painel de assinatura do tenant em
  `apps/web/features/platform-admin/tenants/**` (seletor plano/ciclo/método → gera link → copiar/abrir).

## Fora de escopo

- API (F42-S07). Self-serve portal (F42-S06).

## Arquivos permitidos

- `apps/web/features/platform-admin/tenants/**`

## Arquivos proibidos

- `apps/api/**`, `apps/web/features/billing/**`

## Definition of Done

- [ ] Admin gera e copia/abre o link de cobrança do tenant; erros tratados.
- [ ] Zero hex hardcoded; tokens semânticos; `pnpm --filter @hm/web typecheck`+lint+build verdes.

## UX considerations

- Ação contextual no painel do tenant (evitar gear-only entry, `UX_PRINCIPLES §2`).
- Feedback claro de sucesso/erro ao gerar o link (`UX_PRINCIPLES §3`).
- DS v2 dark-first (CLAUDE.md).

## Permission scope

- Apenas super-admin de plataforma. Ver `docs/features/PERMISSIONS.md` (nível plataforma).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Não validar por Playwright neste host (não hidrata local).
