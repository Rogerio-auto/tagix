---
id: F45-S02
title: Expansão do protocolo outbound (voice:true + location + contacts + reaction)
phase: F45
status: done
priority: high
estimated_size: L
depends_on: []
blocks: [F45-S04, F45-S05, F45-S06, F45-S07]
agent_id: backend-engineer
security_review: required
source_docs:
  - docs/features/RICH_COMPOSER.md
  - docs/features/LIVECHAT.md
completed_at: 2026-06-28T22:19:01Z

---
# F45-S02 [SEC] — Expansão do protocolo outbound

> **source_docs:** `docs/features/RICH_COMPOSER.md` §1–§3; `docs/features/LIVECHAT.md` §3–§4.
> **depends_on:** nenhum (onda 1). **blocks:** F45-S04, F45-S05, F45-S06, F45-S07.

## Objetivo

Levar o pipeline de envio a suportar todas as modalidades novas end-to-end no backend:
(1) **nota de voz nativa** (`voice:true` no serializer para áudio ogg/opus) e os novos kinds
**`location`**, **`contacts`** e **`reaction`** — do schema do job até a borda Meta e a rota HTTP.

## Contexto

`AdapterCapabilities` já declara `voicePtt`/`sticker`/`location`, mas não há caminho de envio:
o serializer manda voice como áudio comum (sem `voice:true`) e não existe location/contacts/
reaction. Este slot define o **contrato** que os slots de frontend (S04–S07) consomem.

## Escopo (faz)

- **Serializer** (`packages/channels/src/meta/whatsapp/serializer.ts`):
  - `serializeMedia`: quando `mediaKind==='voice'` e mime ogg/opus → emitir `audio:{ link, voice:true }`.
  - `serializeLocation(input)` → `{ type:'location', location:{ longitude, latitude, name?, address? } }`.
  - `serializeContacts(input)` → `{ type:'contacts', contacts:[…] }`.
  - `serializeReaction(input)` → `{ type:'reaction', reaction:{ message_id, emoji } }` (emoji `''` = remover).
- **Adapter** (`packages/channels/src/meta/whatsapp/adapter.ts` ou arquivo equivalente do adapter WA):
  `sendLocation`, `sendContacts`, `sendReaction` + entradas no `IChannelAdapter`
  (`packages/channels/src/types.ts`): novos inputs `SendLocationInput`/`SendContactsInput`/
  `SendReactionInput` e métodos (default `{ ok:false, errorCode:'UNSUPPORTED' }` para adapters que não suportam).
- **Schemas compartilhados** (`packages/shared/src/**`, novo módulo `messaging-payloads.ts` + export no index):
  Zod de `LocationPayload`, `ContactPayload`, `ReactionPayload` (validação de lat/long, telefone, emoji único).
- **Job** (`apps/workers/src/outbound/job.ts`): novos membros da `discriminatedUnion`:
  `location` (lat/long/name/address), `contacts` (array), `reaction` (targetExternalId + emoji).
- **Dispatch** (`apps/workers/src/outbound/dispatch.ts`): entradas no `SUPPORTED` map
  (`location`/`contacts` → meta_whatsapp+waha; `reaction` → meta_whatsapp+meta_instagram) e os `case` no switch.
- **Rota** (`apps/api/src/routes/conversations/messages.ts`): `sendSchema` aceita `type`
  `location`/`contact`/`reaction` com um `payload` validado pelos schemas acima; `buildOutboundJob`
  monta o job correto. `reaction` referencia o `external_id` da mensagem-alvo (resolver na rota).

## Fora de escopo

- Transcode/conversão de mídia (S01). Qualquer UI (S04–S07). WAHA além de declarar suporte.

## Arquivos permitidos

- `packages/channels/src/meta/whatsapp/serializer.ts`
- `packages/channels/src/meta/whatsapp/adapter.ts`
- `packages/channels/src/types.ts`
- `packages/channels/src/meta/whatsapp/serializer.test.ts`
- `packages/shared/src/messaging-payloads.ts`
- `packages/shared/src/index.ts`
- `apps/workers/src/outbound/job.ts`
- `apps/workers/src/outbound/dispatch.ts`
- `apps/api/src/routes/conversations/messages.ts`

## Arquivos proibidos

- `apps/api/src/routes/uploads.ts`, `apps/api/src/media/**` (S01)
- `apps/web/**` (S04–S07)

## Contratos de entrada/saída

- `POST /api/conversations/:id/messages` aceita, além do atual:
  - `{ type:'location', payload:{ latitude, longitude, name?, address? } }`
  - `{ type:'contact', payload:{ contacts:[{ name, phones:[…], emails?:[…] }] } }`
  - `{ type:'reaction', payload:{ targetMessageId, emoji } }` (emoji `''` remove)
- OutboundJob ganha kinds `location | contacts | reaction` (shape exato validado por `parseOutboundJob`).

## Definition of Done

- [ ] `serializeMedia` emite `voice:true` só para ogg/opus; demais áudios continuam áudio comum.
- [ ] Serializers de location/contacts/reaction cobertos por teste de unidade (shape Graph correto).
- [ ] `parseOutboundJob` valida os 3 novos kinds; `dispatch` roteia e bloqueia provider incompatível.
- [ ] Rota valida `payload` por Zod (lat∈[-90,90], long∈[-180,180]; reaction exige `targetMessageId`).
- [ ] `reaction` resolve o `external_id` da mensagem-alvo sob RLS (404 se não visível).
- [ ] Zero `any`; `pnpm typecheck` + `pnpm lint` + testes verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/channels test
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. **[SEC]** gate antes do finish: validação Zod de toda input
  externa (lat/long/emoji/telefone), authz da reação (só reage a mensagem visível no tenant — RLS),
  e nenhum vazamento de `external_id` cross-tenant. Mantém o padrão de `buildOutboundJob` (shape
  exato) e a estratégia best-effort de publish já existente. Não quebrar os kinds atuais.
