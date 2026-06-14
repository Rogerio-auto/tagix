---
id: F30-S04
title: IA handoff — auto-pausa ao humano responder
phase: F30
status: done
priority: high
estimated_size: M
depends_on: [F30-S01, F30-S02]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/features/LIVECHAT.md
claimed_at: 2026-06-14T17:13:07Z
completed_at: 2026-06-14T17:19:25Z

---
# F30-S04 — Auto-pausa da IA no handoff humano

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §2; `LIVECHAT.md` §3
> **blocks:** F30-S06

## Objetivo

Quando um atendente humano envia mensagem numa conversa com `ai_mode='on'`, a IA pausa automaticamente (`paused`, `ai_paused_reason='human_takeover'`) para não atropelar o atendente, registrando quem assumiu e quando. Atualiza também `ai_last_human_at` (base do gatilho ocioso de S06).

## Contexto

O envio humano passa por `POST /api/conversations/:id/messages` (`messages.ts`). É o ponto exato pra detectar "humano assumiu". A retomada com contexto é do agent-runtime (S05) e os gatilhos cron são de S06 — este slot é só a transição de estado no envio.

## Escopo (faz)

- `apps/api/src/routes/conversations/messages.ts` (editar) — no POST de envio por **membro humano** (não-agente): se `ai_mode='on'`, na mesma transação setar `ai_mode='paused'`, `ai_paused_reason='human_takeover'`, `ai_paused_at=now()`, `ai_paused_by=<member>`, `ai_last_human_at=now()`; emitir `conversation:ai_mode_changed`.
- Garantir idempotência: se já `paused`/`off`, só atualizar `ai_last_human_at`.
- `apps/api/src/routes/conversations/messages.test.ts` (editar/criar) — envio humano com IA on → vira paused + evento; IA off → sem efeito colateral.

## Fora de escopo

- Toggle manual de IA (S02).
- Retomada com contexto / rotulagem de autoria (S05).
- Gatilhos de reengajamento ocioso/fora-de-horário (S06).

## Arquivos permitidos

- `apps/api/src/routes/conversations/messages.ts`
- `apps/api/src/routes/conversations/messages.test.ts`

## Arquivos proibidos

- `state.ts`/`routing.ts`/`index.ts` (outros slots); `packages/**`; `apps/workers/**`; `apps/agent-runtime/**`.

## Definition of Done

- [ ] Envio humano pausa IA on com reason/by/at corretos; emite evento.
- [ ] `ai_last_human_at` atualizado em todo envio humano.
- [ ] Idempotente (paused/off não regridem).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Distinguir envio humano de envio do agente/flow: o agente envia por outro caminho (worker), então o handler HTTP de membro é seguro como "humano". Confirmar a origem antes de pausar.
