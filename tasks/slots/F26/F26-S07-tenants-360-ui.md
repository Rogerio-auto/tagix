---
id: F26-S07
title: Tenants list + Workspace 360 UI (frontend platform-admin)
phase: F26
status: blocked
priority: medium
estimated_size: L
depends_on: [F26-S02]
agent_id: frontend-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
  - docs/UX_PRINCIPLES.md
---

# F26-S07 — Tenants + Workspace 360 UI

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §4; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Seção **Tenants** no painel: lista buscável/paginável de workspaces (plano, status, uso-mês, #membros, saúde) e a tela **Workspace 360** (drill-down) com resumo, uso/custo, membros, canais, agentes+policy, saúde e audit recente. Consome F26-S02. DS v2 dark-first.

## Contexto

Shell/guard/lib vêm do F25-S06. Adiciona páginas no route group `(platform)/platform/`. É o hub de onde se navega para assinatura (F26-S08), playground (F26-S10) e view-as (F26-S09).

## Escopo (faz)

- `apps/web/app/(platform)/platform/tenants/page.tsx` + `apps/web/app/(platform)/platform/tenants/[id]/page.tsx`.
- `apps/web/features/platform-admin/tenants/**`: tabela (busca/paginação/filtros por status/plano), 360 (cards de resumo/uso/membros/canais/agentes/saúde/audit), links p/ assinatura/playground/view-as.

## Fora de escopo

- Editar assinatura (F26-S08), view-as (F26-S09), playground (F26-S10). Shell/nav/lib (F25-S06 — reusar). Backend (F26-S02).

## Arquivos permitidos

- `apps/web/app/(platform)/platform/tenants/**`
- `apps/web/features/platform-admin/tenants/**`

## Arquivos proibidos

- `apps/web/features/platform-admin/{shell,lib}/**` (F25-S06 — reusar, não editar), outras subpastas de `platform-admin`

## Definition of Done

- [ ] Lista de tenants com busca/paginação/filtros + Workspace 360 completo (resumo/uso/membros/canais/agentes/saúde/audit); links de navegação para os outros pilares.
- [ ] DS v2 dark-first (zero hex); skeleton no loading; **nenhum secret exibido** (só metadados).
- [ ] `pnpm --filter @hm/web typecheck` + lint + `build` verdes.

## UX considerations

- **§3.6** skeleton; **§2.4** nav clara; **§3.1** selecionar antes de agir (clicar tenant → 360, ações no 360).
- **§2.5** help inline `?` p/ métricas de saúde, não tooltip.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Reusa `features/platform-admin/lib` (client/types) do F25. A entrada na nav do shell é adicionada pelo orchestrator na integração frontend (glue), junto com os links das demais páginas F26.
