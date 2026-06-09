---
id: F1-S09
title: IChannelAdapter + capabilities + graphClient + MetaInstagramAdapter STUB
phase: F1
status: blocked
priority: critical
estimated_size: M
depends_on: [F1-S01]
---

# F1-S09 — IChannelAdapter interface + capabilities

> **source_docs:** `docs/features/LIVECHAT.md` §2.1, §2.2; `docs/features/INSTAGRAM.md`
> **blocks:** F1-S08 (WA adapter), F1-S18 (WAHA), F1-S04, F1-S07

## Objetivo
Definir a fronteira `IChannelAdapter` (union meta_whatsapp|meta_instagram|waha) com `capabilities` que a UI consulta, o cliente HTTP Graph compartilhado, os tipos `InboundEvent`/`SendResult`, e o `MetaInstagramAdapter` como STUB (impl real em F1.5).

## Escopo (faz)
- `packages/channels/src/types.ts` — `IChannelAdapter`, `InboundEvent` (union), `SendResult`, `capabilities` (LIVECHAT §2.1).
- `packages/channels/src/shared/graphClient.ts` — cliente graph.facebook.com/v23.0 + retry + token; `errors.ts` (MetaError).
- `packages/channels/src/meta/instagram/adapter.ts` — STUB que retorna `IG_NOT_IMPLEMENTED`/logged-warn (capabilities corretas).
- Barrel `packages/channels/src/index.ts` (atualiza o skeleton).

## Arquivos permitidos
- `packages/channels/src/types.ts`, `packages/channels/src/shared/**`, `packages/channels/src/meta/instagram/**`, `packages/channels/src/index.ts`

## Definition of Done
- [ ] Interface + capabilities + InboundEvent/SendResult tipados.
- [ ] graphClient com retry/erro tipado.
- [ ] MetaInstagramAdapter STUB implementa a interface (capabilities IG verdadeiras).
- [ ] typecheck + lint.

## Validação
```bash
pnpm typecheck
pnpm lint
```

## Notas
HMAC/webhook receive são SHARED (F1-S02), não por adapter (mesmo Meta App). Mantém os tipos do skeleton (`ChannelProvider`).
