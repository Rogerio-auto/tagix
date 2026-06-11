---
id: F8-S07
title: Settings Workspace (org) — info/marca/membros/departamentos/times/auto-assign/horário/SLAs + API
phase: F8
status: done
priority: high
estimated_size: L
depends_on: [F8-S01, F8-S05]
agent_id: backend-engineer
claimed_at: 2026-06-11T20:16:07Z
completed_at: 2026-06-11T20:22:42Z

---
# F8-S07 — Settings Workspace (organização)

> **source_docs:** `docs/features/PERMISSIONS.md` §2, §5; `docs/UX_PRINCIPLES.md` §3; `docs/ROADMAP.md` F8-S10
> **blocks:** —

## Objetivo
Seções de operação do workspace: Workspace (nome/timezone), Marca (logo/cor leve), Membros (convidar + trocar role), Departamentos (CRUD), Times (CRUD + membros), Auto-assign (config — reusa F1-S23), Horário comercial, SLAs (limites que alimentam o dashboard). Mais a API de membros/departamentos/times/SLA.

## Escopo (faz)
- `apps/api/src/routes/workspace/**`: `PATCH /api/workspace` (info/marca), `POST/PATCH /api/members` (invite + role-change com guard OWNER/ADMIN), `apps/api/src/routes/org/**` (departments/teams CRUD), config de auto-assign/horário/SLA.
- `apps/web/features/settings/sections/workspace-org/**`: as seções correspondentes (forms dirty-tracking, typing-to-confirm em mudanças críticas como trocar role de OWNER §5.1).

## Fora de escopo
- Schema (F8-S01: departments/teams/SLA), seções de integração/tags/audit (F8-S08), shell (F8-S05).

## Arquivos permitidos
- `apps/api/src/routes/workspace/**`
- `apps/api/src/routes/org/**`
- `apps/web/features/settings/sections/workspace-org/**`

## Permission scope
- Editar workspace/marca/departamentos/times/SLA → `workspace.edit`/ADMINS; convidar/trocar role → OWNER/ADMIN (trocar role de OWNER só OWNER, typing-to-confirm). Cite/adicione perms em `permissions.ts` se faltarem (coordene: F8-S05 não toca permissions; este slot pode adicionar `member.invite`/`workspace.edit` se inexistentes).

## Definition of Done
- [ ] Workspace info/marca salvam; membros: convidar + trocar role (com guards e typing-to-confirm); departamentos/times CRUD; auto-assign/horário/SLA configuráveis.
- [ ] `pnpm --filter @hm/api test` + `pnpm --filter @hm/web build` + lint/typecheck verdes.

## UX considerations
- §5.1 form único por seção + dirty-tracking; mudança crítica (role OWNER, remover membro) com typing-to-confirm ("REMOVER"); §3 estados 3-partes; tokens DS v2 (zero hex na marca — cor da marca é input do usuário, ok).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **backend-engineer** (API org/membros) + **frontend-engineer** (seções) — coordene. Slot L — se passar de ~500 linhas, separe Membros/Departamentos/Times do resto. Auto-assign reusa o engine de F1-S23.
