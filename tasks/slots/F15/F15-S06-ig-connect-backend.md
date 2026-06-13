---
id: F15-S06
title: IG connect backend — Embedded Signup + seleção Page/IGBA + webhook subscription + test msg
phase: F15
status: review
priority: high
estimated_size: M
depends_on: [F15-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
claimed_at: 2026-06-13T00:06:18Z
completed_at: 2026-06-13T00:09:56Z

---
# F15-S06 — IG connect backend (API)

> **source_docs:** `docs/features/INSTAGRAM.md` §2, §12.1, §15
> **blocks:** F15-S07

## Objetivo

Backend do fluxo de conexão de um canal Instagram (Tech Provider / Embedded Signup): trocar o código do Facebook Login por token, listar Páginas FB + IG Business Account vinculada, validar conta Business/Creator (rejeitar Personal), inscrever Page+IGBA no webhook do app via Graph, criar a row `channels` (provider `meta_instagram`, `igUserId`, `fbPageId`, token cifrado em `channel_secrets`), e enviar a mensagem de teste — marcando `is_active`.

## Contexto

O schema `channels` já tem os campos IG. O connect de WhatsApp já existe (mesmo Embedded Signup, scopes combinados WA+IG, INSTAGRAM.md §12.1 step 2). Este slot adiciona o ramo IG do connect: seleção de conta, subscription e criação do canal.

## Escopo (faz)

- `apps/api/src/routes/channels/**` (ramo IG): endpoints do wizard — listar páginas/IGBA do token, validar Business/Creator, subscrever Page+IGBA no webhook, criar canal IG + cifrar token (AES-256-GCM, mesmo padrão WA), enviar test message.
- `apps/api/src/services/channels/**` (se existir; senão inline): Graph calls de subscription + validação.

## Fora de escopo

- UI do wizard (F15-S07). Adapter/send (F15-S01). Webhook receive (F15-S02).

## Arquivos permitidos

- `apps/api/src/routes/channels/**`
- `apps/api/src/services/channels/**`

## Arquivos proibidos

- `apps/api/src/routes/webhooks/**` (F15-S02), `apps/api/src/app.ts`

## Definition of Done

- [ ] Fluxo connect IG: token → lista Page/IGBA → valida Business/Creator (rejeita Personal) → subscreve webhook → cria channel (igUserId/fbPageId, token cifrado) → test message → is_active.
- [ ] Token cifrado em `channel_secrets` (nunca em claro/log); WhatsApp connect **inalterado**.
- [ ] Permission scope: só `owner`/`admin` conecta canal (PERMISSIONS §2).
- [ ] `pnpm --filter @hm/api test` (connect IG, Graph mockado) + lint/typecheck verdes.

## Permission scope

Conectar/gerenciar canal: `owner`/`admin`. Ver `docs/features/PERMISSIONS.md §2`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Reusa crypto de `channel_secrets` (mesmo de WA) e o GraphClient (F15-S01). Subscription: Page + IGBA no app webhook (INSTAGRAM.md §12.1 step 4).
