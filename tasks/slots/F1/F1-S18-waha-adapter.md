---
id: F1-S18
title: WAHAAdapter (inbound + outbound) + session management
phase: F1
status: in-progress
priority: high
estimated_size: M
depends_on: [F1-S09]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:06:08Z

---
# F1-S18 — WAHAAdapter

> **source_docs:** `docs/features/LIVECHAT.md` §2.3; WAHA HTTP API
> **blocks:** F1-S07

## Objetivo
Adapter WAHA (WhatsApp não-oficial) implementando `IChannelAdapter`, com gestão de sessão (ensure ativa, retry 409/422).

## Escopo (faz)
- `packages/channels/src/waha/{adapter,webhook.parser,client,session}.ts` — parse inbound + send (text/media/voice/sticker/location), capabilities WAHA; session ensure/retry.

## Arquivos permitidos
- `packages/channels/src/waha/**`

## Definition of Done
- [ ] Inbound parser + outbound send; session management com retry.
- [ ] Capabilities corretas (voicePtt/sticker/location true; templatesHSM false).
- [ ] typecheck + lint + test do parser.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/channels test
```

## Notas
WAHA não tem janela 24h (composer sempre livre). Deauth de sessão → notifica admin (UI em F1-S19).
