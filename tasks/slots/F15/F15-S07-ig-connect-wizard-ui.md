---
id: F15-S07
title: IG connect wizard (frontend) — passo Instagram no ConnectChannelWizard
phase: F15
status: blocked
priority: medium
estimated_size: M
depends_on: [F15-S06]
agent_id: frontend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
  - docs/UX_PRINCIPLES.md
---

# F15-S07 — IG connect wizard (frontend)

> **source_docs:** `docs/features/INSTAGRAM.md` §12.1; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Adicionar o caminho **Instagram** ao wizard de conexão de canais (`features/settings/channels`): opção IG no passo de escolha, Facebook Login (Embedded Signup com scopes combinados), seleção de Página FB + IG Business Account, subscription e mensagem de teste — consumindo os endpoints do F15-S06, com UX DS v2 (sem template, sem modal-cobre-tudo).

## Contexto

O wizard de WhatsApp já existe (`ConnectChannelWizard`/`ConnectWizard`). Este slot adiciona o ramo IG (INSTAGRAM.md §12.1: 5 passos). Backend (F15-S06) expõe os endpoints; aqui é só a UI client.

## Escopo (faz)

- `apps/web/features/settings/channels/**`: opção "Instagram" no passo 1; fluxo Embedded Signup; seleção Page+IGBA (passo 3); feedback de subscription + test message (passo 5); estados de erro humanos (§2.11).

## Fora de escopo

- Backend connect (F15-S06). Inbox/comment UI (F15-S08).

## Arquivos permitidos

- `apps/web/features/settings/channels/**`

## Arquivos proibidos

- `apps/web/features/conversations/**` (F15-S08)

## Definition of Done

- [ ] IG selecionável no wizard; fluxo completo até `is_active=true` + test message; erros claros.
- [ ] DS v2 dark-first, tokens semânticos (zero hex); WhatsApp connect na mesma tela **inalterado**.
- [ ] `pnpm --filter @hm/web typecheck` + lint verdes; `pnpm --filter @hm/web build` verde.

## UX considerations

- **§2.3/§3.2**: passos em painel/drawer, não modal-cobre-tudo.
- **§2.11** (erro-misterioso): falhas de Graph/subscription com mensagem humana + retry.
- **§2.7** (feedback): cada passo (login/seleção/subscription/test) mostra progresso/sucesso claro.
- **§3.4** (empty state convida): estado sem canais convida a conectar.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**.
- Paraleliza com F15-S08 (settings/channels vs conversations disjuntos). Reaproveita o componente de wizard existente do WA.
