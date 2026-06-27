---
id: F52-S08
title: Inbound consistente — ordenação fiel (provider_timestamp) + dedup de disparo de flow
phase: F52
status: available
priority: high
estimated_size: M
depends_on: [F52-S01]
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
  - docs/features/FLOW_BUILDER.md
  - docs/features/INSTAGRAM.md
---
# F52-S08 — Inbound consistente: ordenação + dedup de flow

> **Origem:** survey desta sessão. Fragilidades: ordenação por hora de inserção (reprocessamento embaralha), parser IG descarta timestamp do provider, e retry de inbound dispara o mesmo flow 2×.

## Objetivo

Garantir que as mensagens apareçam na conversa **na ordem real do provider** e que o reprocessamento de um envelope inbound (retry) **não dispare o mesmo flow novamente**.

## Contexto / causa raiz (confirmada)

1. **Ordenação:** `messages` ordena por `created_at` (hora de inserção). `packages/channels/src/meta/instagram/webhook.parser.ts:109-153` retorna eventos de story sem `rawTimestamp` e `apps/workers/src/inbound/instagram-inbound.ts` força `new Date()` → ordem incorreta em reprocessamento/fora-de-ordem.
2. **Dedup de flow:** `apps/workers/src/inbound/db-ports.ts:481` chama `contactMessageHook.onContactMessage()` por mensagem; se o envelope é reentregue, a mensagem é dedup'd (`uq_messages_external`) mas o hook roda de novo e `dispatchTriggersForNewMessage` (`flows-triggers/dispatcher.ts`) re-dispara os flows. Não há dedup no nível de disparo.

## Escopo (faz)

- **Persistir `provider_timestamp`** (coluna de F52-S01) ao inserir mensagens, vindo do timestamp real do provider.
- **Corrigir o parser IG** para propagar o `rawTimestamp` real (parar de descartá-lo) e remover o `new Date()` forçado em `instagram-inbound.ts` (usar fallback só quando o provider genuinamente não envia).
- **Ordenar a listagem** por `coalesce(provider_timestamp, created_at) desc` em `packages/db/src/repos/livechat.ts` (índice criado em F52-S01).
- **Dedup de disparo de flow:** só disparar triggers quando a mensagem foi **realmente inserida** (não no caminho de dedup/no-op). Tornar o hook condicional à inserção efetiva — se a mensagem já existia (reentrega), não re-disparar flows. Coordenar `db-ports.ts` (sinalizar "inserida vs duplicada") com o dispatcher.

## Fora de escopo

- Coluna de schema (F52-S01).
- Lock pessimista no resume de flows waiting (deixar como follow-up; aqui o foco é não duplicar disparo em reentrega).
- Frontend de ordenação (a query já alimenta a UI).

## Arquivos permitidos

- `apps/workers/src/inbound/db-ports.ts`
- `apps/workers/src/inbound/instagram-inbound.ts`
- `apps/workers/src/flows-triggers/**`
- `packages/channels/src/meta/instagram/webhook.parser.ts`
- `packages/db/src/repos/livechat.ts`

## Arquivos proibidos

- `apps/workers/src/inbound/status.ts` (F52-S04) · `packages/db/src/schema/**` (F52-S01) · `apps/web/**`

## Definition of Done

- [ ] Mensagens persistem `provider_timestamp` do provider; WhatsApp/WAHA/IG cobertos.
- [ ] Teste: parser IG de story preserva o timestamp do payload (não `new Date()`).
- [ ] Teste: listagem ordena por `provider_timestamp` (mensagem reprocessada não pula para o fim).
- [ ] Teste: reentrega de envelope com mensagem já existente **não** dispara flow de novo (1 execução, não 2).
- [ ] Caminho feliz: nova mensagem dispara os flows configurados normalmente.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
pnpm --filter @hm/db test
```

## Notas

- `onConflictDoNothing` permite detectar inserção efetiva via `RETURNING` (linhas retornadas) — usar isso para sinalizar "inserida" ao hook.
- Não quebrar o resume de flows WAITING (`resumeWaitingFlows`): resume ≠ trigger; o dedup é só do **disparo de novo flow**, não do resume.
