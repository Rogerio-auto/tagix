---
id: F26-S09
title: View-as UI — botão "Ver como", banner global persistente, kill-switch, sessões ativas
phase: F26
status: blocked
priority: medium
estimated_size: M
depends_on: [F26-S05]
agent_id: frontend-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
  - docs/UX_PRINCIPLES.md
---

# F26-S09 — View-as UI (read-only)

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §6; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

UI do **view-as READ-ONLY**: botão "Ver como" no Workspace 360 (abre sessão com motivo) → o app de workspace carrega no contexto do tenant alvo com um **banner global persistente e inescapável** ("Vendo como {workspace} · read-only · Sair") + **kill-switch**; e uma lista de sessões ativas no painel (encerrar). Consome F26-S05.

## Contexto

Backend (sessão + middleware read-only) vem do F26-S05. O banner aparece no app `(app)` enquanto a sessão de impersonation está ativa (claim separado). Decisão travada: **read-only** — UI deixa explícito que não há escrita.

## Escopo (faz)

- `apps/web/features/platform-admin/impersonation/**`: botão "Ver como" (modal de motivo) + lista de sessões ativas (encerrar).
- `apps/web/app/(platform)/platform/impersonation/page.tsx`: sessões ativas.
- `apps/web/shared/components/impersonation-banner/**` (novo): banner global persistente (cor distinta, "Sair" sempre visível, indica read-only).
- `apps/web/app/(app)/layout.tsx` (editar, aditivo): montar `<ImpersonationBanner/>` quando há sessão ativa.
- `apps/web/middleware.ts` (editar, aditivo): reconhecer o claim de impersonation no edge (sem regredir auth normal nem o guard de `(platform)` do F25).

## Fora de escopo

- act-as/escrita (fase futura). Backend (F26-S05). Outros pilares.

## Arquivos permitidos

- `apps/web/features/platform-admin/impersonation/**`
- `apps/web/app/(platform)/platform/impersonation/**`
- `apps/web/shared/components/impersonation-banner/**`
- `apps/web/app/(app)/layout.tsx`
- `apps/web/middleware.ts`

## Arquivos proibidos

- `apps/web/features/platform-admin/{shell,lib,tenants,plans,subscriptions}/**`

## Definition of Done

- [ ] "Ver como" abre sessão (com motivo) e entra no contexto do tenant; banner global persistente com "Sair" + indicação read-only em TODAS as telas do app durante impersonation.
- [ ] Kill-switch encerra; lista de sessões ativas no painel; auth normal e guard de `(platform)` **inalterados**.
- [ ] DS v2 (banner com cor distinta); `pnpm --filter @hm/web typecheck` + lint + `build` verdes.

## UX considerations

- Banner **inescapável** (§ não-esconder): sempre visível, cor própria, "Sair" 1-clique.
- **§2.7** feedback ao entrar/sair do modo; **§2.11** erro humano se a sessão expirar (volta ao normal com aviso).
- Read-only explícito na UI (botões de escrita desabilitados/ocultos com tooltip explicando) — coerente com o 403 do backend.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Toca `(app)/layout.tsx` e `middleware.ts` de forma ADITIVA (banner + claim) — não regredir o app de workspace. Paraleliza com F26-S08/S10 (subdirs disjuntos).
