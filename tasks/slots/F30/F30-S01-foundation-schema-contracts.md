---
id: F30-S01
title: Foundation — schema visibilidade/peer + ai-handoff + contratos shared
phase: F30
status: available
priority: critical
estimated_size: L
depends_on: []
agent_id: db-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/features/PERMISSIONS.md
  - docs/DATA_MODEL.md
---

# F30-S01 — Fundação de dados + contratos da F30

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §1/§2/§5; `docs/features/PERMISSIONS.md` §2.1
> **blocks:** F30-S02, S03, S04, S05, S06, S07, S08, S09, S10

## Objetivo

Criar toda a base de dados e os contratos compartilhados que destravam as 3 ondas da F30: tabelas de política de visibilidade + override por membro, coluna de peer-privacy no time, colunas de handoff de IA em `conversations`, repos de scoping/auto-assign, e os contratos em `@hm/shared` (permissions novas, socket-events, tipos Zod).

## Contexto

É a **fundação crítica** — quase tudo na F30 depende deste slot. Centraliza schema + contratos num único PR pra que os 9 slots seguintes importem tipos estáveis e rodem em paralelo. `main` verde, `packages/db` estável.

## Escopo (faz)

### packages/db
- `packages/db/src/schema/inbox.ts` (novo):
  - `inbox_visibility_settings` — 1 linha por workspace (`workspace_id` UNIQUE): `default_peer_visibility` ∈ `shared|private` (default `shared`), `readonly_sees_all` boolean. Defaults de role são derivados em código (não precisam de coluna), mas reservar `role_overrides` jsonb pra futuro.
  - `member_visibility_overrides` — (`workspace_id`, `member_id`, `department_id`) PK composta; concede visibilidade extra a um membro sobre um departamento.
- `packages/db/src/schema/org.ts` (editar): adicionar `teams.peer_visibility` text default `'inherit'` + check `in ('shared','private','inherit')`.
- `packages/db/src/schema/conversations.ts` (editar): adicionar `ai_paused_reason` (`human_takeover|manual|null`), `ai_paused_at` ts, `ai_paused_by` uuid→members SET NULL, `ai_last_human_at` ts (base do gatilho ocioso), `ai_resume_at` ts (reengajamento agendado, nullable).
- `packages/db/src/schema/index.ts` (editar): exports + registrar as 2 tabelas novas em `RLS_TABLES`.
- Migration versionada (`drizzle-kit generate` + bloco RLS manual no `.sql`, padrão do repo): policy `USING (workspace_id = current_setting('app.workspace_id')::uuid)` nas tabelas novas; `ALTER TABLE` para colunas novas (default-safe, sem reescrever tabela grande).
- `packages/db/src/repos/livechat.ts` (editar): helpers tipados consumidos downstream —
  - `buildVisibilityPredicate({ memberId, role, workspaceId })` → predicado SQL (Drizzle `SQL`) que aplica eixo-1 (depts visíveis) + eixo-2 (peer-privacy) para a list query (S07).
  - `resolvePeerVisibility(conversation)` → `shared|private` resolvido (team ?? workspace).
  - `pickAutoAssignee({ teamId, strategy })` → memberId candidato (round_robin/least_busy) ou null (S09).
- `packages/db/src/rls.test.ts` (editar): cross-tenant nega leitura de `inbox_visibility_settings` e `member_visibility_overrides`.

### packages/shared
- `packages/shared/src/permissions.ts` (editar): adicionar `conversation.resolve`, `conversation.snooze`, `conversation.ai_mode`, `inbox.visibility.manage` na matriz `ROLE_CAN` (roles conforme `LIVECHAT_OPS.md §5`).
- `packages/shared/src/socket-events.ts` (editar): adicionar `conversation:ai_mode_changed` ({ conversationId, aiMode, reason }) e `conversation:state_changed` ({ conversationId, status }).
- `packages/shared/src/types/inbox.ts` (novo): enums/Zod de `PeerVisibility`, `AiMode`, `AiPausedReason`, `VisibilityPolicy` — fonte única importada por API/web.
- Re-export no barrel de `@hm/shared` (`packages/shared/src/index.ts`).

## Fora de escopo

- Endpoints (S02/S07/S08), worker (S06/S09), runtime (S05), UI (S03/S10). Aqui é só schema + repos + contratos.
- Lógica de auto-assign em si (S09 usa `pickAutoAssignee`); enforcement (S07 usa `buildVisibilityPredicate`).

## Arquivos permitidos

- `packages/db/src/schema/inbox.ts`
- `packages/db/src/schema/org.ts`
- `packages/db/src/schema/conversations.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/livechat.ts`
- `packages/db/drizzle/**`
- `packages/db/src/rls.test.ts`
- `packages/shared/src/permissions.ts`
- `packages/shared/src/socket-events.ts`
- `packages/shared/src/types/inbox.ts`
- `packages/shared/src/index.ts`

## Arquivos proibidos

- `apps/**`, qualquer outro arquivo de `packages/db` ou `packages/shared` não listado.

## Definition of Done

- [ ] Tabelas novas criadas com RLS + registradas em `RLS_TABLES`; teste cross-tenant nega leitura.
- [ ] Colunas de handoff em `conversations` e `teams.peer_visibility` aplicadas via migration default-safe.
- [ ] Repos `buildVisibilityPredicate` / `resolvePeerVisibility` / `pickAutoAssignee` tipados (sem `any`), com testes unit do happy path.
- [ ] Permissions + socket-events + tipos Zod exportados em `@hm/shared`.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/db test` verdes; migration aplica limpa.

## Permission scope

Define as permissions; não monta endpoint. Roles conforme `PERMISSIONS.md §2.1` (ai_mode/resolve/snooze = STAFF, das suas pra AGENT) e `LIVECHAT_OPS.md §5` (`inbox.visibility.manage` = OWNER/ADMIN).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **db-engineer**. Espelhe `org.ts`/`conversions.ts` (RLS na migration custom, índices parciais).
- `buildVisibilityPredicate` é o coração da segurança da Onda C — modele os casos: OWNER/ADMIN (sem filtro), SUPERVISOR (depts liderados via `team_members.role='lead'`), AGENT (depts em `team_members` + overrides), e o eixo peer (`private` → `assigned_to = :memberId OR member é lead do team`).
- Índices: garantir índice em `member_visibility_overrides(member_id)` e em `conversations(team_id)`/`(department_id)` pra manter o hot-path da list barato.
