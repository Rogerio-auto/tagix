# RICH_COMPOSER — Modalidades de envio do LiveChat (F45)

> Estende o composer do LiveChat para todas as modalidades de envio outbound que o
> WhatsApp Cloud API suporta e que ainda faltam. Hoje funcionam **texto** e **mídia
> anexada** (imagem/vídeo/áudio/PDF via `POST /api/uploads`). Esta feature adiciona:
> **nota de voz gravada no navegador**, **emoji**, **sticker**, **localização**,
> **reação (emoji)** e **contato**. Padrão world-class, DS v2, zero `any`.

## 1. Capacidades reais do provider (pesquisado — Meta Cloud API v24.0)

Tipos de mensagem do endpoint `POST /{phone-number-id}/messages`:
`text · template · image · video · audio · document · sticker · location · contacts · interactive · reaction`.

Restrições que ditam a arquitetura:

| Modalidade | Requisito duro do WhatsApp | Implicação |
|---|---|---|
| **Nota de voz (PTT)** | Nota de voz **nativa** (player + onda) exige **`audio/ogg` com codec OPUS** + flag `voice:true`. `audio/opus` (sem ogg) é rejeitado (erro 131053). Outros formatos viram "áudio comum". | O `MediaRecorder` do navegador gera `audio/webm;codecs=opus` (Chrome) ou `audio/mp4` (Safari) — **nenhum** é ogg/opus. ⇒ **transcode server-side (ffmpeg)** no upload + serializer manda `voice:true`. |
| **Sticker** | `image/webp`, 512×512; estático ≤100 KB, animado ≤500 KB. Sem caption. | Imagem escolhida pelo agente precisa ser **convertida server-side (sharp) → webp 512²**. |
| **Localização** | `{ longitude, latitude, name?, address? }`. | Novo `kind` outbound + serializer + UI (geolocation atual / busca). |
| **Contato** | `contacts: [{ name, phones[], emails?, … }]`. | Novo `kind` outbound + serializer + UI (escolher contato do workspace). |
| **Reação** | `{ type:'reaction', reaction:{ message_id, emoji } }`. `emoji:''` remove. Reage a uma mensagem **recebida** (precisa do `external_id` dela). | Novo `kind` outbound + serializer + UI na bolha (não no composer). |
| **Emoji** | n/a (texto puro). | 100% frontend: inserir no textarea. |

Fontes: [Cloud API — Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/) ·
[Audio/voice messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages/) ·
[MediaRecorder (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) ·
[isTypeSupported (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).

## 2. Estado atual do código (survey)

- `packages/channels/src/types.ts` — `AdapterCapabilities` **já declara** `voicePtt`, `sticker`, `location` (antecipado). Inbound já tem evento `reaction`. **Não há** `sendLocation`/`sendContacts`/`sendReaction` no `IChannelAdapter`.
- `packages/channels/src/meta/whatsapp/serializer.ts` — `serializeMedia` mapeia `voice → audio` **sem** `voice:true` (vira áudio comum). Não há serializer de location/contacts/reaction.
- `apps/workers/src/outbound/job.ts` — `outboundJobSchema` tem `text · media · template · interactive · ig_* · typing_indicator`. **Faltam** `location · contacts · reaction`. `media` já aceita `mediaKind: voice|sticker`.
- `apps/workers/src/outbound/dispatch.ts` — `SUPPORTED` map por provider; roteia kind→método do adapter.
- `apps/api/src/routes/conversations/messages.ts` — `sendSchema` (`content`/`type`/`mediaUrl`/`mediaMime`); `TYPE_TO_MEDIA_KIND` já tem `voice`/`sticker`/`document`.
- `apps/api/src/routes/uploads.ts` — `POST /api/uploads` (raw → R2 → URL assinada). **Sem** transcode/conversão.
- `apps/web/.../MessageComposer/MessageComposer.tsx` — só textarea + anexo (Paperclip). Sem emoji/voz/sticker/localização.

## 3. Decomposição (F45 — 7 slots)

**Backend (onda 1, paralelos):**
- **F45-S01** — Normalização de mídia no upload: voz→`audio/ogg;opus` (ffmpeg), sticker→`webp 512²` (sharp).
- **F45-S02** — Expansão do protocolo outbound: `voice:true` + novos kinds `location`/`contacts`/`reaction` (job schema + types + serializer + adapter + dispatch + rota).

**Frontend (consome o contrato):**
- **F45-S03** — Refactor da barra de ações do composer + **emoji picker**. (scaffold do toolbar; dono de `MessageComposer.tsx`)
- **F45-S04** — **Gravador de voz** (MediaRecorder + onda + timer + cancelar/enviar). dep S01,S02,S03.
- **F45-S05** — **Menu de anexo**: enviar **sticker** + **localização**. dep S01,S02,S03,S04.
- **F45-S06** — **Reações** de emoji na bolha de mensagem (enviar + exibir). dep S02. *(standalone)*
- **F45-S07** — Enviar **contato** do workspace. dep S02,S03,S05. *(prioridade baixa)*

Grafo: `S01,S02,S03 → S04 → S05 → S07`; `S02 → S06`. Onda 1 = S01+S02+S03 em paralelo.

## 4. UX (DS v2, ver `docs/UX_PRINCIPLES.md`)

- Ações ricas vivem numa **barra explícita** ao lado do input — nunca escondidas só atrás de um ícone de engrenagem (anti-padrão *gear-only*). Ícones `lucide` + tooltip.
- Gravação de voz: estado dedicado que **substitui** o input (timer + onda + ✕ cancelar + ➤ enviar); soltar fora não envia acidentalmente. Pedir permissão de mic com fallback claro se negada.
- Emoji/sticker/localização em **popover** ancorado (não modal full-screen — anti-padrão).
- Reação: hover/long-press na bolha → mini-picker; otimista (UX §2.7).
- Tudo respeita a janela de 24h (composer já bloqueia fora da janela) e o gate de permissão `conversation.assign` (STAFF).
