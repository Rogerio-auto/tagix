---
id: F39-S02
title: WhatsApp connect wizard UI — Embedded Signup (FB Login) + seleção de número + modo coexistência
phase: F39
status: blocked
priority: high
estimated_size: M
depends_on: [F39-S01]
agent_id: frontend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
  - docs/UX_PRINCIPLES.md
blocks: [F39-S05]
---
# F39-S02 — WhatsApp connect wizard UI

> **source_docs:** `docs/features/INSTAGRAM.md` §12.1 · `docs/UX_PRINCIPLES.md` §2/§3
> **depende de:** F39-S01 (endpoint `/api/channels/whatsapp/connect`)

## Objetivo

UI do fluxo de conexão WhatsApp: dispara o **Embedded Signup** (FB Login) já existente, deixa o usuário escolher o **modo** (Cloud API novo número × **coexistência** com número já no app WhatsApp Business), coleta o PIN quando aplicável, e chama o endpoint server-side (F39-S01). Espelha o `ConnectWizard` do Instagram.

## Contexto

`apps/web/features/channels/` já tem `ConnectWizard.tsx`, `fb-login.ts` (Embedded Signup) e `ChannelsManager.tsx`. Este slot adiciona o ramo WhatsApp server-side (hoje o connect WA é o manual). Reusa o padrão visual e de estados já aprovado do wizard IG.

## Escopo (faz)

- `apps/web/features/channels/**`: ramo WhatsApp do `ConnectWizard` — seleção de modo (Cloud API / coexistência), Embedded Signup via `fb-login.ts` (escopos WA), captura de `code`/`phoneNumberId`/`wabaId`/PIN, chamada a `POST /api/channels/whatsapp/connect`, estados de loading/erro/sucesso, atualização da lista de canais.
- `apps/web/app/(app)/settings/channels/**`: ajustes de página se necessário (entrada do wizard).

## Fora de escopo

- Backend do connect (F39-S01). Qualquer parsing de webhook ou worker. Inbox/conversas.

## Arquivos permitidos

- `apps/web/features/channels/**`
- `apps/web/app/(app)/settings/channels/**`

## Arquivos proibidos

- `apps/api/**` · `apps/workers/**` · `packages/channels/**`

## Definition of Done

- [ ] Wizard WA: escolhe modo → Embedded Signup (FB Login) → confirma número/PIN → chama `/api/channels/whatsapp/connect` → canal aparece ativo na lista.
- [ ] Erros do Graph/registro exibidos de forma clara (sem stacktrace cru); segredos nunca expostos no client.
- [ ] DS v2: tokens semânticos de `@hm/design-tokens`, zero hex hardcoded.
- [ ] `pnpm --filter @hm/web typecheck` + `pnpm lint` verdes; build do web ok.

## UX considerations

- **Não usar full-screen modal** para o wizard (anti-padrão `docs/UX_PRINCIPLES.md §2`) — seguir o mesmo padrão de painel/stepper do `ConnectWizard` IG já aprovado.
- **Entrada explícita** (não esconder atrás de ícone-engrenagem isolado — anti-padrão "gear-only entry" §2): botão claro "Conectar WhatsApp" no card de canais.
- Estados visíveis de progresso/erro/sucesso (§3 feedback); coexistência precisa de copy explicando que mensagens do app aparecerão no inbox.

## Permission scope

Conectar canal: `owner`/`admin`. Ver `docs/features/PERMISSIONS.md §2`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Reusa `fb-login.ts` (Embedded Signup já existe para WA+IG). e2e real não roda verde neste host (ver memória `e2e-no-hydration-this-host`) — validar por typecheck/lint/build.
