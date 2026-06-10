---
id: F4-S08
title: API CRUD flows + publish (version) + trigger manual + executions + cancel + manual-order
phase: F4
status: done
priority: high
estimated_size: M
depends_on: [F4-S01, F4-S02, F4-S07]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:50:05Z
completed_at: 2026-06-10T20:54:18Z

---
# F4-S08 — API Flow Builder

> **source_docs:** `docs/features/FLOW_BUILDER.md` §7, §10; `docs/features/PERMISSIONS.md` (flow.*); `docs/ROADMAP.md` F4-S09
> **blocks:** F4-S09, F4-S10, F4-S12

## Objetivo
API REST do Flow Builder (§10): CRUD de flows, publish (valida via F4-S07 → snapshot em `flow_versions` + `status=active`), unpublish/archive, trigger manual (chama `triggerFlow`), versions, executions + detalhe com logs, cancel, e `PATCH /api/flows/manual-order` (manual_position).

## Escopo (faz)
- `apps/api/src/routes/flows/**`: factory(ies) de router (montadas em `app.ts` pelo orchestrator) com os 12 endpoints do §10, validação Zod, RLS.
- `publish`: roda `validateFlow` (F4-S07); se inválido → 422 com issues; senão cria `flow_versions(version=max+1)` e ativa.
- `trigger`: `requireRole('flow.trigger')` → `triggerFlow({ triggeredBy: 'manual' })`.

## Fora de escopo
- Engine/validação (F4-S02/S07), UI (F4-S09+), worker.

## Arquivos permitidos
- `apps/api/src/routes/flows/**`

## Permission scope (PERMISSIONS — flow.*)
- `GET` list/detail/logs/executions → `flow.list`/`flow.view_logs` (ALL).
- `POST/PUT` create/update/archive → `flow.edit` (ADMINS); `publish`/`unpublish` → `flow.publish` (ADMINS).
- `trigger` → `flow.trigger` (STAFF); `executions/:id/cancel` → `flow.cancel` (STAFF).

## Definition of Done
- [ ] 12 endpoints do §10 sob RLS + Zod; publish valida e versiona; trigger dispara execução.
- [ ] Guards de permissão por endpoint conforme matriz acima.
- [ ] `pnpm --filter @hm/api test` (engine/db mockados) + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Execuções em curso referenciam `flow_version_id` — publish NÃO afeta execuções rodando (§7).
