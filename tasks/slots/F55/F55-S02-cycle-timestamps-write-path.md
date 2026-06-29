---
id: F55-S02
title: Popular first_response_at/resolved_at/closed_at nas transições reais (write path)
phase: F55
status: available
priority: high
estimated_size: M
depends_on: [F55-S01]
blocks: [F55-S08]
agent_id: backend-engineer
source_docs:
  - docs/features/DASHBOARD.md
---
# F55-S02 — Popular timestamps de ciclo no write path

## Objetivo

Gravar `first_response_at`/`resolved_at`/`closed_at` **no momento exato** em que cada evento acontece, para
que SLA/TTR/TMR fiquem precisos de agora em diante (o backfill do S01 cobre só o passado, aproximado).

## Contexto

Pontos de mutação já mapeados:
- **1ª resposta de member** (outbound): insert em `apps/api/src/routes/conversations/messages.ts:468`
  (`direction:'outbound', senderType:'member'`), seguido de updates da conversa em `:521`/`:536`.
- **Status → resolved/closed (manual):** `apps/api/src/routes/conversations/state.ts:173`
  (`POST /:id/status`, `.update(conversations).set({ status })`).
- **Status → resolved/closed (agent/flow):** `apps/api/src/internal/tools/workflow-handlers.ts`
  — `markResolved` (`:99`, status `resolved`) e `changeConversationStatus` (`:119`, status alvo).

## Escopo

### files_allowed
- `apps/api/src/routes/conversations/messages.ts`
- `apps/api/src/routes/conversations/state.ts`
- `apps/api/src/internal/tools/workflow-handlers.ts`
- `apps/api/src/routes/conversations/__tests__/**`
- `apps/api/src/internal/tools/__tests__/**`

### files_forbidden
- `packages/db/**` (schema é S01), `apps/api/src/services/dashboard/**` (S04), `apps/web/**`, `apps/workers/**`

## Escopo (faz)
- **first_response_at:** ao persistir a 1ª mensagem outbound de member numa conversa, setar
  `conversations.first_response_at = now()` **apenas se ainda NULL** (`COALESCE`/guard — nunca sobrescrever).
  Aproveitar o update de conversa que já roda em `messages.ts` (não criar query extra desnecessária).
- **resolved_at:** ao mudar status para `resolved`, setar `resolved_at = now()` se NULL.
- **closed_at:** ao mudar status para `closed`, setar `closed_at = now()` se NULL.
- Aplicar a regra nos **três** lugares de status (state.ts manual + markResolved + changeConversationStatus),
  via um helper compartilhado pequeno se reduzir duplicação (dentro de files_allowed).
- Reabrir conversa (status volta a open/pending) **não** limpa os timestamps (são marcos de "primeira vez";
  decisão: manter histórico do 1º fechamento — documentar na nota).

## Fora de escopo
- Colunas/migration (S01). MV (S03). Emit de socket (S08). Queries de dashboard (S04).

## Contratos de saída
- A partir deste slot, conversas novas têm timestamps exatos — consumidos por S03 (MV) e S04 (queries SLA/TTR).

## Permission scope
Sem permissão nova. A escrita acontece dentro das mutações já autorizadas (`conversation.resolve`/`.snooze`
em state.ts; agent tools já gated). RLS via `withRLS`/tx existente.

## Definition of Done
- [ ] 1ª resposta de member grava `first_response_at` uma única vez (idempotente em respostas seguintes).
- [ ] Transição para resolved/closed grava o timestamp correspondente nos 3 caminhos.
- [ ] Testes de integração cobrindo: 1ª vs 2ª resposta; resolve manual; resolve via agent tool.
- [ ] `pnpm typecheck`, `pnpm lint` verdes; testes de conversations existentes não regridem.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Guard "só se NULL" é essencial — sem ele o first_response_at viraria "última resposta". Best-effort não se
aplica aqui: o timestamp faz parte da transação da mutação (consistência forte), diferente do emit de socket.
