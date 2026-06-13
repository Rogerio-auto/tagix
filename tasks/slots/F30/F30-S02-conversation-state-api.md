---
id: F30-S02
title: API de estado da conversa — status + ai_mode toggle
phase: F30
status: blocked
priority: high
estimated_size: M
depends_on: [F30-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/features/LIVECHAT.md
  - docs/features/PERMISSIONS.md
---

# F30-S02 — Conversation state API (status + ai_mode)

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §2/§3; `docs/features/LIVECHAT.md` §7.3; `PERMISSIONS.md` §2.1
> **blocks:** F30-S03, F30-S04

## Objetivo

Expor a API que faltava pra operar uma conversa: mudar status (resolver / snooze / reabrir) e alternar o `ai_mode` (on / off / paused). Atribuição/transferência já existem (`routing.ts`) — este slot **não os toca**, só completa o que falta e monta o router novo.

## Contexto

Hoje não há endpoint para status nem para IA — a coluna `ai_mode` existe e o worker a respeita, mas nada a muta. Sem isto, o cockpit (S03) e o handoff (S04) não têm o que chamar.

## Escopo (faz)

- `apps/api/src/routes/conversations/state.ts` (novo) — `createConversationStateRouter()`:
  - `POST /api/conversations/:id/status` — body `{ status: 'open'|'resolved'|'snoozed'|'pending', snoozedUntil? }`. Guard `conversation.resolve`/`conversation.snooze` conforme ação; AGENT só nas suas (checa `assignedTo`). Atualiza + emite `conversation:state_changed`.
  - `POST /api/conversations/:id/ai-mode` — body `{ aiMode: 'on'|'off'|'paused', reason? }`. Guard `conversation.ai_mode`. Atualiza `ai_mode` (+ limpa/seta `ai_paused_*` conforme). Emite `conversation:ai_mode_changed`.
  - Reusar o publisher de relay no padrão de `routing.ts` (mesma fila `hm.q.socket.relay`).
- `apps/api/src/app.ts` (editar) — montar `createConversationStateRouter()` (único slot da F30 que toca `app.ts`).
- `apps/api/src/routes/conversations/state.test.ts` (novo) — happy path + authz (AGENT em conversa alheia = 403) + Zod inválido = 400.

## Fora de escopo

- Assign/transfer (já em `routing.ts` — proibido tocar).
- Auto-pausa no envio humano (S04, em `messages.ts`).
- Lista escopada (S07, em `index.ts`).
- UI (S03).

## Arquivos permitidos

- `apps/api/src/routes/conversations/state.ts`
- `apps/api/src/routes/conversations/state.test.ts`
- `apps/api/src/app.ts`

## Arquivos proibidos

- `apps/api/src/routes/conversations/{index,messages,routing,window,notes}.ts`
- Qualquer schema em `packages/**` (contratos vêm de S01).

## Definition of Done

- [ ] Os 2 endpoints funcionam; emitem socket; gravam estado.
- [ ] `requireRole` + escopo AGENT-só-nas-suas aplicados; testes de authz passam.
- [ ] Zod valida input; erros no padrão `LIVECHAT.md` (mensagem útil).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

`conversation.resolve` / `conversation.snooze` / `conversation.ai_mode` = OWNER/ADMIN/SUPERVISOR/AGENT (AGENT só nas atribuídas a ele). `PERMISSIONS.md §2.1`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Copie a estrutura de relay/guards de `routing.ts` (mesmo arquivo de domínio, não o edite).
- `snoozed` exige `snoozedUntil` futuro; `resolved`/`open` ignoram. Ao sair de `snoozed` por nova inbound, quem reabre é o worker (fora deste slot) — aqui só a ação manual.
