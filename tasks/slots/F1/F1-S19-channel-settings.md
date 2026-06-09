---
id: F1-S19
title: Channel settings page + connect wizard (Meta FB Login + WAHA)
phase: F1
status: blocked
priority: high
estimated_size: M
depends_on: [F1-S01, F1-S03, F0-S11]
---

# F1-S19 — Channel settings + connect wizard

> **source_docs:** `docs/features/LIVECHAT.md`; `docs/features/INSTAGRAM.md`; `docs/features/PERMISSIONS.md` §2.6
> **blocks:** —

## Objetivo
Tela de canais: listar/conectar/desativar canais. Wizard de conexão Meta (FB Login) + WAHA. Passos IG-específicos stubados.

## Escopo (faz)
- `apps/web/app/(app)/settings/channels/**` + `apps/web/features/channels/**` (lista, status, wizard).
- `apps/api/src/routes/channels/**` — CRUD de channels + troca de tokens (cifra via crypto F1-S01), guard `channel.connect`/`channel.delete`.

## Arquivos permitidos
- `apps/web/app/(app)/settings/channels/**`, `apps/web/features/channels/**`, `apps/api/src/routes/channels/**`

## Definition of Done
- [ ] Conectar WhatsApp (wizard FB Login) + WAHA; desativar; status do canal (WAHA deauth visível).
- [ ] requireRole (`channel.connect` OWNER/ADMIN; `channel.delete` OWNER); typecheck + lint + build.

## Permission scope
- `channel.connect`/`channel.disable` = OWNER/ADMIN; `channel.delete` = OWNER (PERMISSIONS.md §2.6).

## UX considerations
- Aplica UX §2.8 (wizard multi-step com salvamento), §2.4 (path de entrada óbvio em Settings).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
