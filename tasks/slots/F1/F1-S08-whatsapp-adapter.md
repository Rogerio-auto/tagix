---
id: F1-S08
title: MetaWhatsAppAdapter completo (sendText/Media/Template/Interactive + parser)
phase: F1
status: done
priority: critical
estimated_size: L
depends_on: [F1-S09]
agent_id: backend-engineer
claimed_at: 2026-06-09T23:55:10Z
completed_at: 2026-06-09T23:55:34Z

---
# F1-S08 — MetaWhatsAppAdapter

> **source_docs:** `docs/features/LIVECHAT.md` §2.2, §4; Graph API WhatsApp Cloud
> **blocks:** F1-S07, F1-S10, F1-S20

## Objetivo
Adapter WhatsApp Cloud completo: parse de webhook inbound + envio (text/media/template/interactive) + downloadMedia + markAsRead + typing.

## Escopo (faz)
- `packages/channels/src/meta/whatsapp/{adapter,webhook.parser,serializer,errors}.ts` — implementa `IChannelAdapter` para `meta_whatsapp`; códigos de erro WA (130472, 131026, 131047, 131051, 132001…).
- Parser → `InboundEvent[]`; serializer dos tipos suportados; capabilities WA.

## Arquivos permitidos
- `packages/channels/src/meta/whatsapp/**`

## Definition of Done
- [ ] sendText/sendMedia/sendTemplate/sendInteractive + downloadMedia/markAsRead/typing implementados.
- [ ] Parser cobre text/image/video/audio/voice/document/sticker/location/contact/interactive/status.
- [ ] Erros mapeados (tipados); testes unit do parser + serializer.
- [ ] typecheck + lint + test.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/channels test
```

## Notas
Mídia: `downloadMedia` baixa pela Graph (URL + token). 24h window é regra do outbound (F1-S07/S17), não do adapter.
