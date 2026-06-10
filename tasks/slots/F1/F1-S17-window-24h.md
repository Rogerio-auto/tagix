---
id: F1-S17
title: Janela 24h Meta no composer + CTA template (WA) + state machine IG-ready
phase: F1
status: in-progress
priority: high
estimated_size: M
depends_on: [F1-S16, F1-S07]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:44:31Z

---
# F1-S17 — Janela 24h + message_tag

> **source_docs:** `docs/features/LIVECHAT.md` §3.3; `docs/features/INSTAGRAM.md` §6
> **blocks:** —

## Objetivo
Aplicar a regra de janela de envio por provider: WA bloqueia composer fora de 24h (CTA "Reabrir com template"); IG mostra banner Human Agent Tag (prepara state); WAHA sempre livre. Audit log obrigatório quando `messageTag != null`.

## Escopo (faz)
- `getComposerState(conversation, channel)` (front + regra espelhada no back/worker outbound).
- Composer: lock + CTA template (WA); banner IG-ready. Outbound aplica `messageTag` + audit log.

## Arquivos permitidos
- `apps/web/features/conversations/components/MessageComposer/**` (sequencial após F1-S16), `apps/api/src/routes/conversations/window.ts`

## Definition of Done
- [ ] WA: composer bloqueia >24h com CTA template; IG: banner + tag; WAHA: livre.
- [ ] Audit log em outbound com message_tag; typecheck + lint + build.

## UX considerations
- Aplica UX §2.11 (erro/estado claro: "Janela 24h fechada — o quê/por quê/o que fazer").

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
