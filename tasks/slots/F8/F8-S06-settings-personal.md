---
id: F8-S06
title: Settings Pessoal — perfil/preferências/senha/sessões/notificações + API
phase: F8
status: review
priority: high
estimated_size: M
depends_on: [F8-S05]
agent_id: backend-engineer
claimed_at: 2026-06-11T20:08:51Z
completed_at: 2026-06-11T20:14:22Z

---
# F8-S06 — Settings Pessoal

> **source_docs:** `docs/features/PERMISSIONS.md` §5; `docs/UX_PRINCIPLES.md` §3; `docs/ROADMAP.md` F8-S09
> **blocks:** —

## Objetivo
As 9 seções pessoais do painel: Perfil (nome/avatar), Preferências (theme/density/locale), Dashboard (link p/ F8-S04), Notificações (toggles on/off MVP), Sons, Atalhos (referência), Sessões (listar/revogar), Senha (trocar), Conta. Mais a API que falta (perfil/preferências/senha/sessões).

## Escopo (faz)
- `apps/api/src/routes/members/me.ts`: `PATCH /api/members/me` (perfil/preferências), `POST /api/members/me/password`, `GET/DELETE /api/members/me/sessions`.
- `apps/web/features/settings/sections/personal/**`: as 9 seções (forms com dirty-tracking + help inline), consumindo a API.

## Fora de escopo
- Shell do settings (F8-S05), seção dashboard-obrigatórios (F8-S04), workspace settings (F8-S07).

## Arquivos permitidos
- `apps/api/src/routes/members/me.ts`
- `apps/web/features/settings/sections/personal/**`

## Permission scope
- Tudo é escopo do próprio member (qualquer role edita o seu). Trocar senha exige reautenticação leve (senha atual) — mock provider aceita, mas valide o fluxo.

## Definition of Done
- [ ] Perfil/preferências salvam (PATCH); senha troca; sessões listam e revogam; notificações/sons/atalhos/conta renderizam (toggles MVP).
- [ ] `pnpm --filter @hm/api test` + `pnpm --filter @hm/web build` + lint/typecheck verdes.

## UX considerations
- §5.1 form único por seção com dirty-tracking (Salvar desabilitado até mudar); mudança crítica (revogar sessão) com confirmação; §3 estados de erro 3-partes; tokens DS v2.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Preferências (theme/density) já têm stores no web (theme.store/ui.store) — a seção persiste no member e sincroniza. Monta no `SectionRegistry` de F8-S05.
