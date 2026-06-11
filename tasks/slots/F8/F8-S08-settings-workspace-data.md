---
id: F8-S08
title: Settings Workspace (dados) — tags CRUD + integração das seções existentes + audit viewer
phase: F8
status: blocked
priority: medium
estimated_size: M
depends_on: [F8-S05]
---
# F8-S08 — Settings Workspace (dados + integrações)

> **source_docs:** `docs/features/PERMISSIONS.md` §5, §6; `docs/UX_PRINCIPLES.md` §3; `docs/ROADMAP.md` F8-S11, F8-S12, F8-S18
> **blocks:** —

## Objetivo
Fechar o painel de workspace: gestão de **Tags** (CRUD UI sobre `tags`), **integração das seções de features já construídas** (Canais F1, Agentes IA F2, Knowledge Base F3, Pipeline F5, Conversões F5 — montar/linkar no shell, não reconstruir), e o **Audit log viewer** (seção Auditoria, sobre `audit_logs`, com filtros — per-workspace ADMIN).

## Escopo (faz)
- `apps/web/features/settings/sections/workspace-data/**`: `TagsManager` (CRUD + cor), `AuditLogViewer` (lista filtrada de `audit_logs`), e wrappers que montam as páginas de settings já existentes (channels/agents/kb/pipeline/conversions) dentro do shell + contadores.
- `apps/api/src/routes/tags.ts` + `apps/api/src/routes/audit.ts`: CRUD de tags + `GET /api/audit` (filtros, RLS) se não existirem.

## Fora de escopo
- Reconstruir features já feitas (só linka/monta), seções de org (F8-S07), shell (F8-S05).

## Arquivos permitidos
- `apps/web/features/settings/sections/workspace-data/**`
- `apps/api/src/routes/tags.ts`
- `apps/api/src/routes/audit.ts`

## Permission scope
- Tags CRUD → ADMINS/MANAGERS; Audit viewer → ADMIN (per-workspace). Seções linkadas mantêm suas próprias perms.

## Definition of Done
- [ ] Tags CRUD funciona; audit viewer lista `audit_logs` filtrado sob RLS; seções de features existentes acessíveis pelo shell com contadores corretos.
- [ ] `pnpm --filter @hm/api test` + `pnpm --filter @hm/web build` + lint/typecheck verdes.

## UX considerations
- §3 tags com chips coloridos; audit viewer com filtros claros (quem/quando/o quê); §5.1 dirty-tracking onde há edição; tokens DS v2.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Webhooks/API keys/Billing/Compliance ficam para F9/pós-MVP — não são desta fase. Monta no `SectionRegistry` de F8-S05.
