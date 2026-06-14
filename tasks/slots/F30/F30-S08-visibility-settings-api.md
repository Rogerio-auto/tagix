---
id: F30-S08
title: API de configuração de visibilidade + peer-privacy
phase: F30
status: review
priority: high
estimated_size: M
depends_on: [F30-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-14T14:39:33Z
completed_at: 2026-06-14T15:46:49Z

---
# F30-S08 — Visibility settings API

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §1/§5; `PERMISSIONS.md` §4.2
> **blocks:** F30-S10

## Objetivo

Endpoints para o dono configurar a privacidade: default de peer-visibility do workspace, overrides de visibilidade por membro, e o `peer_visibility` por time. Guard `inbox.visibility.manage` (OWNER/ADMIN), com auditoria.

## Contexto

As tabelas existem (S01). Faltam os endpoints de leitura/escrita, plugados nas rotas de org (`org/org.ts`, que já gerencia departments/teams). Consome a UI de S10.

## Escopo (faz)

- `apps/api/src/routes/org/org.ts` (editar) — adicionar:
  - `GET/PUT /api/org/inbox-visibility` — lê/escreve `inbox_visibility_settings` (default_peer_visibility, readonly_sees_all).
  - `GET/PUT /api/org/members/:id/visibility-overrides` — lista/atualiza `member_visibility_overrides` (depts extras).
  - `PATCH /api/org/teams/:id/peer-visibility` — seta `teams.peer_visibility` (shared|private|inherit).
  - Guard `inbox.visibility.manage`; registrar `audit_logs` em toda escrita (`settings.inbox.visibility_changed`).
- `apps/api/src/routes/org/routes.test.ts` (editar) — authz (SUPERVISOR/AGENT = 403), escrita persiste, auditoria registrada.

## Fora de escopo

- Enforcement na list (S07).
- UI (S10).
- CRUD de departments/teams em si (já existe — só adicionar peer_visibility ao team).

## Arquivos permitidos

- `apps/api/src/routes/org/org.ts`
- `apps/api/src/routes/org/routes.test.ts`

## Arquivos proibidos

- `apps/api/src/routes/conversations/**`; `packages/**`.

## Definition of Done

- [ ] 3 grupos de endpoint funcionam; persistem; auditam.
- [ ] Guard `inbox.visibility.manage` (OWNER/ADMIN) aplicado; testes authz passam.
- [ ] Zod valida enums (de `@hm/shared` tipos de S01).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

`inbox.visibility.manage` = OWNER/ADMIN (`LIVECHAT_OPS.md §5`). Configuração de workspace (`PERMISSIONS.md §4.2`).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Reusar o padrão de auditoria já usado nas demais escritas de settings (`audit_logs`, `actor_member_id`, `metadata.old/new`).
