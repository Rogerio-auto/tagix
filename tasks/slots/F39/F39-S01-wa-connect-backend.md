---
id: F39-S01
title: WhatsApp connect backend — Embedded Signup server-side (Cloud API + coexistência onboarding)
phase: F39
status: review
priority: critical
estimated_size: L
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
  - docs/features/LIVECHAT.md
blocks: [F39-S02, F39-S03]
claimed_at: 2026-06-19T04:53:01Z
completed_at: 2026-06-19T05:02:31Z

---
# F39-S01 — WhatsApp connect backend (Tech Provider server-side)

> **source_docs:** `docs/features/INSTAGRAM.md` §12.1 (padrão Embedded Signup) · `docs/features/LIVECHAT.md` §2.4 (webhook) · Meta WhatsApp Cloud API / Embedded Signup / Coexistence (docs públicas — ver Notas)
> **blocks:** F39-S02 (UI), F39-S03 (ingestão coexistência)

## Objetivo

Completar o onboarding **server-side** de um canal WhatsApp como Tech Provider, espelhando o que o Instagram já tem (`instagram-connect.ts`): trocar o `code` do Embedded Signup por **token long-lived** (usa `META_APP_ID`/`META_APP_SECRET`), **registrar o número** na Cloud API (`POST /{phone_number_id}/register` com PIN), **inscrever a WABA** no app (`POST /{waba_id}/subscribed_apps`) e criar o `channel` (provider `meta_whatsapp`) com token cifrado. Suporta dois modos: **Cloud API padrão** e **coexistência** (subscribed_apps com os campos de coexistência).

## Contexto

Hoje `POST /api/channels/connect` apenas **recebe** `accessToken` + `phoneNumberId` + `wabaId` prontos e cifra — não faz troca de token, register nem subscription. Sem `subscribed_apps`, a WABA **não entrega webhooks**. Este slot fecha o gap, deixando o onboarding WA no mesmo nível do IG. A ingestão runtime da coexistência (echoes/history) é a Onda 2 (F39-S03/S04).

## Escopo (faz)

- `apps/api/src/services/channels/whatsapp-connect.ts` (novo, espelha `instagram-connect.ts`): funções puras sobre o `GraphClient` de `@hm/channels` — `exchangeCodeForToken(code)`, `registerPhoneNumber(phoneNumberId, pin, token)`, `subscribeWabaApp(wabaId, token, { coexistence })`, helpers de leitura de WABA/phone.
- `apps/api/src/routes/channels/**`: novo endpoint `POST /api/channels/whatsapp/connect` (e wizard endpoints se necessário) que orquestra exchange → register → subscribe → cria `channel` + cifra token em `channel_secrets`. Dispatch por `mode: 'cloud_api' | 'coexistence'`.
- `packages/channels/src/meta/whatsapp/adapter.ts`: helper de register/subscribe se fizer sentido reusar o cliente Graph (sem quebrar o envio existente).
- Modo de conexão (`cloud_api`/`coexistence`) persistido **sem migração de schema** — usar coluna/JSONB já existente em `channels` (ex.: settings). Se um campo dedicado for indispensável, abrir sub-slot de DB.

## Fora de escopo

- UI do wizard (F39-S02). Ingestão/parse de webhooks de coexistência — echoes/history/app_state (F39-S03). Workers de sync (F39-S04). O `/api/channels/connect` legado (manual) permanece funcionando.

## Arquivos permitidos

- `apps/api/src/routes/channels/**`
- `apps/api/src/services/channels/whatsapp-connect.ts`
- `packages/channels/src/meta/whatsapp/adapter.ts`

## Arquivos proibidos

- `apps/api/src/routes/webhooks/**` (F39-S03)
- `packages/channels/src/meta/whatsapp/webhook.parser.ts` (F39-S03)
- `apps/api/src/services/channels/instagram-connect.ts`
- `apps/workers/**` (F39-S04) · `packages/db/src/schema/**`

## Contratos

- **Entrada:** `POST /api/channels/whatsapp/connect` `{ code, phoneNumberId, wabaId, pin, mode }` (token NUNCA volta ao cliente).
- **Saída:** `201 { channel }` (colunas públicas, sem segredos). Token long-lived cifrado em `channel_secrets` (AES-256-GCM, mesmo padrão WA/IG).
- **Graph:** `GET /oauth/access_token` (exchange), `POST /{phone_number_id}/register`, `POST /{waba_id}/subscribed_apps`.

## Definition of Done

- [ ] Fluxo connect WA server-side: code→token long-lived → register (PIN) → subscribed_apps (WABA) → cria channel (`meta_whatsapp`, token cifrado) → `is_active`.
- [ ] Modo `coexistence` inscreve os campos de coexistência (`history`, `smb_message_echoes`, `smb_app_state_sync`) no `subscribed_apps`; modo `cloud_api` inscreve o padrão (`messages`).
- [ ] Token cifrado em `channel_secrets` (nunca em claro/log); `/api/channels/connect` legado inalterado.
- [ ] Permission scope: só `owner`/`admin` conecta canal (PERMISSIONS §2).
- [ ] `pnpm --filter @hm/api test` (connect WA, Graph mockado) + lint/typecheck verdes.

## Permission scope

Conectar/gerenciar canal: `owner`/`admin`. Ver `docs/features/PERMISSIONS.md §2`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Espelhe `apps/api/src/services/channels/instagram-connect.ts` (mesma forma: funções puras sobre `GraphClient`, sem persistência no service; a rota persiste).
- `META_APP_ID`/`META_APP_SECRET` vêm de `platformSecrets` (já mapeados em `apps/api/src/secrets/index.ts`). Em produção, preenchidos na Onda 0.
- Coexistência (Meta WhatsApp Coexistence): o Embedded Signup usa `feature_type=whatsapp_business_app_onboarding`/coexistence; o `subscribed_apps` precisa dos campos `history`, `smb_message_echoes`, `smb_app_state_sync`. Confirmar contra a doc oficial vigente da Meta no momento da implementação (a versão do Graph é v23.0 — `packages/channels/src/shared/graphClient.ts`).
- Slot grande (L): estruture standard vs coexistência em funções separadas no service para manter o diff revisável.
