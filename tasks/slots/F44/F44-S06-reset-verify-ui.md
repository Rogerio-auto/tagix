---
id: F44-S06
title: UI de reset real (tira o mock) + /verify + NewPasswordForm — branding Leadium
phase: F44
status: in-progress
priority: high
estimated_size: M
depends_on: [F44-S04]
blocks: []
agent_id: frontend-engineer
security_review: optional
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
claimed_at: 2026-06-22T18:53:22Z

---
# F44-S06 — UI de reset real + verify

> source_docs: docs/features/SELF_SERVE_SIGNUP.md §5
> depends_on: S04. Disjunto de S05 (files_allowed nao se cruzam) — paraleliza com S05.

## Objetivo

Tornar o reset de senha real (remover o atalho mock de queries.ts) e adicionar a tela de
verificacao de email (/verify) que consome o token do link e o POST /auth/verify (S04).

## Escopo (faz)

- apps/web/features/auth/queries.ts NAO esta no files_allowed deste slot (e do S05). Para o
  reset real, este slot edita o NewPasswordForm e o page de reset; o useRequestReset (em
  queries.ts) ja chama POST /auth/reset quando AUTH_MOCK e false — coordenar via COMMS se
  precisar mexer em queries.ts (pertence a S05). Preferir nao depender disso: ver Notas.
- apps/web/app/(auth)/reset-password/page.tsx — branding Leadium (era Highermind); copy real.
- apps/web/features/auth/components/NewPasswordForm.tsx (novo) — form para definir a nova senha
  a partir do token do link de reset (forca de senha, confirmacao), chamando o endpoint real.
- apps/web/app/(auth)/verify/page.tsx (novo) + componente de verificacao: le o token da query,
  chama POST /auth/verify, mostra estado sucesso ("email confirmado, faca login") ou erro
  uniforme. Branding Leadium.

## Fora de escopo

- Signup (S05). Hardening de loading/sessao/open-redirect e middleware (S07).
- Editar queries.ts/schema.ts (pertencem a S05 — coordenar por COMMS se inevitavel).

## Arquivos permitidos

- apps/web/app/(auth)/reset-password/page.tsx
- apps/web/app/(auth)/verify/**
- apps/web/features/auth/components/NewPasswordForm.tsx
- apps/web/features/auth/components/VerifyEmail.tsx

## Arquivos proibidos

- apps/web/features/auth/queries.ts, schema.ts (S05)
- apps/web/app/(auth)/signup/**, middleware.ts (S05/S07)
- apps/web/shared/** (S07)

## Definition of Done

- [ ] reset-password com branding Leadium; reset chama o endpoint REAL (sem caminho mock).
- [ ] NewPasswordForm define nova senha com forca + confirmacao.
- [ ] /verify consome o token do link, chama POST /auth/verify, estados sucesso/erro uniformes.
- [ ] Branding Leadium em todas as telas tocadas; DS v2 (zero hex).
- [ ] pnpm typecheck + pnpm lint + pnpm --filter @hm/web build verdes.

## Validacao

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: frontend-engineer. A query de reset real (useRequestReset) e o /verify a
  PUBLIC_PREFIXES sao responsabilidade do S05/S07; se este slot precisar do helper de query,
  abrir nota em COMMS.md. E2E nao hidrata — validar por build.
