---
id: F15-S04
title: Outbound dispatch IG — worker envia text/media/interactive/comment + janela 24h/MESSAGE_TAG
phase: F15
status: in-progress
priority: high
estimated_size: M
depends_on: [F15-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
claimed_at: 2026-06-13T00:01:17Z

---
# F15-S04 — Outbound dispatch IG (workers)

> **source_docs:** `docs/features/INSTAGRAM.md` §5.3, §6, §14
> **blocks:** F15-S05

## Objetivo

No worker outbound, despachar os `OutboundJob` de Instagram (text, media, interactive, `ig_private_reply`, `ig_public_reply`, `ig_hide_comment`, typing) via `MetaInstagramAdapter`, com **enforcement da janela de 24h + MESSAGE_TAG** (fora da janela, só envia com tag válido — HUMAN_AGENT/CONFIRMED_EVENT_UPDATE/POST_PURCHASE_UPDATE/ACCOUNT_UPDATE; senão bloqueia com erro tipado + log audit) e erro tipado para `kind` incompatível com o provider.

## Contexto

O worker outbound já seleciona adapter por `channel.provider` (adapter-factory liga `meta_instagram`). Este slot implementa o ramo IG do dispatch + a lógica de janela/tag (INSTAGRAM.md §6). Template (HSM) não existe em IG → erro `IG_NO_HSM`.

## Escopo (faz)

- `apps/workers/src/outbound/**`: ramo IG do `dispatchOutbound` — mapeia cada `OutboundJob` IG ao método do adapter; persiste resultado (message status sent/failed + remote id).
- Enforcement janela 24h: calcula última inbound do contato; fora de 24h exige `messageTag` válido, senão bloqueia (métrica `hm.ig.window.outbound_blocked`) + `audit_logs` com justificativa quando tag usado (§15).
- `kind` incompatível (ex. `template` para IG) → erro tipado, não crash.
- Métricas `hm.ig.outbound.message_tag_used{tag}` (reusa observability F10-S01).

## Fora de escopo

- API que enfileira comment actions (F15-S05). Inbound (F15-S03). Adapter em si (F15-S01).

## Arquivos permitidos

- `apps/workers/src/outbound/**`

## Arquivos proibidos

- `apps/workers/src/inbound/**` (F15-S03), `apps/workers/src/observability/**` (reusar)

## Definition of Done

- [ ] Todos os kinds IG despachados via adapter; resultado persistido (sent/failed + remote id).
- [ ] Janela 24h: dentro envia normal; fora exige MESSAGE_TAG válido, senão bloqueia com erro tipado + métrica + audit.
- [ ] `kind` incompatível com IG → erro tipado (sem crash); WhatsApp outbound **inalterado**.
- [ ] `pnpm --filter @hm/workers test` (IG outbound + janela, http/db mockados) + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Especialista: **backend-engineer**.
- Paraleliza com F15-S03 (subdir outbound vs inbound disjuntos). Janela 24h IG é diferente de WA (sem HSM) — vide INSTAGRAM.md §6.1.
