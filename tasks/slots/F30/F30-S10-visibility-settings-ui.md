---
id: F30-S10
title: Settings UI — visibilidade + peer-privacy por time
phase: F30
status: review
priority: medium
estimated_size: M
depends_on: [F30-S08]
agent_id: frontend-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/features/PERMISSIONS.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-14T17:13:16Z
completed_at: 2026-06-14T17:23:20Z

---
# F30-S10 — Settings UI de visibilidade

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §1/§3; `PERMISSIONS.md` §4.2/§5; `UX_PRINCIPLES.md` §2/§4
> **blocks:** —

## Objetivo

Telas em Configurações → Workspace para o dono operar a privacidade: default de peer-visibility do workspace, override de visibilidade por membro, e o `peer_visibility` por time (no editor de times). Mais o parâmetro de filtros da inbox (query params de dept/team/assigned) no hook da lista.

## Contexto

A API existe (S08). Falta a UI. Vai numa nova seção `workspace-org` + extensão do `TeamsSection.tsx`. Aplica padrões de UX (drawer, help inline, confirmação proporcional).

## Escopo (faz)

- `apps/web/features/settings/sections/workspace-org/InboxVisibilitySection.tsx` (novo) — switch default peer-visibility (shared/private) + lista de overrides por membro (adicionar/remover dept extra).
- `apps/web/features/settings/sections/workspace-org/TeamsSection.tsx` (editar) — campo `peer_visibility` (shared/private/inherit) no editor do time.
- `apps/web/features/settings/sections/workspace-org/queries.ts` (editar) — chamadas à API de S08.
- `apps/web/features/settings/sections/workspace-org/index.ts` + `apps/web/features/settings/shell/registry.tsx` (editar) — registrar a seção nova na sidebar de settings.
- `apps/web/features/conversations/hooks/useChatList.ts` (editar) — repassar filtros dept/team/assigned como query params pro GET escopado (S07). **Único slot que toca este hook** (S03 não toca).

## Fora de escopo

- Backend (S08/S07).
- Cockpit/header/filtros-UI da inbox (S03 — a UI dos dropdowns de filtro; aqui só o hook que monta a query).

## Arquivos permitidos

- `apps/web/features/settings/sections/workspace-org/InboxVisibilitySection.tsx`
- `apps/web/features/settings/sections/workspace-org/TeamsSection.tsx`
- `apps/web/features/settings/sections/workspace-org/queries.ts`
- `apps/web/features/settings/sections/workspace-org/index.ts`
- `apps/web/features/settings/shell/registry.tsx`
- `apps/web/features/conversations/hooks/useChatList.ts`

## Arquivos proibidos

- `apps/web/features/conversations/components/**` (S03); demais seções de settings; `packages/**`, `apps/api/**`.

## Definition of Done

- [ ] Seção de visibilidade salva default + overrides; time salva peer_visibility.
- [ ] Filtros de inbox chegam à API como query params (dept/team/assigned).
- [ ] Esconde para quem não tem `inbox.visibility.manage` (`can(role,...)`).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- Aplica §2.4 — entrada óbvia na sidebar de settings (não escondida).
- Aplica §2.5 — explicação dos modos shared/private em **HelpPanel `?`**, não tooltip.
- Aplica §2.7 — salvar com feedback (dirty-tracking + toast).
- Aplica §2.8/§5 — um formulário por seção com Salvar habilitado só em dirty.
- Aplica §2.9 — overrides por membro como lista clara, não mega-form.

## Permission scope

UI só para `inbox.visibility.manage` (OWNER/ADMIN); autoridade no backend (S08). `PERMISSIONS.md §4.2`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. DS v2: tokens semânticos, zero hex. Help inline explicando o impacto de "private" (cada um só vê as suas) — é a config mais sensível pro dono entender.
