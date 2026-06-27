---
id: F52-S05
title: Resiliência de mídia — media_status, retry de download, evento media_failed
phase: F52
status: done
priority: high
estimated_size: M
depends_on: [F52-S01]
blocks: [F52-S07]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
completed_at: 2026-06-27T13:09:58Z

---
# F52-S05 — Resiliência de mídia (backend)

> **Origem:** survey desta sessão. Fragilidades CRÍTICAS: URL expirada classificada como não-retentável → mídia perdida pra sempre; sem estado de mídia → placeholder eterno; sem evento de falha.

## Objetivo

Tornar o pipeline de mídia resiliente: download com retry, estado de mídia rastreável (`pending→downloading→ready|failed`) e um evento socket de falha para o frontend reagir — nenhuma mídia "presa carregando" silenciosamente.

## Contexto / causa raiz (confirmada)

`apps/workers/src/media/pipeline.ts:58-78`: erro `MetaError retryable=false` (404/URL expirada) é descartado imediatamente — a URL temporária da Meta expira em ~10-30s e o doc promete "retry 3× em 4min" que **não está implementado**. Não há coluna de estado (F52-S01 cria) nem evento de falha (`message:media_ready` existe; `message:media_failed` não).

## Escopo (faz)

- **Transições de `media_status`** (coluna de F52-S01): marcar `downloading` ao iniciar, `ready` ao concluir upload, `failed` ao esgotar tentativas. Mídia inbound nasce `pending`.
- **Retry com backoff** no download (incluindo o caso de URL expirada — re-resolver a URL fresca via adapter quando possível, já que o `external_id` permite re-fetch dos metadados da mídia na Graph API). Limite de tentativas + dead-letter via a malha de F52-S03.
- **Evento `message:media_failed`** (adicionar em `packages/shared/src/socket-events.ts`): `{ conversationId, messageId, reason }`, emitido quando a mídia falha definitivamente.
- Continuar emitindo `message:media_ready` no sucesso (não regredir) e o dedup SHA-256 existente.
- Log estruturado + base para métrica de taxa de falha de mídia (a superfície visual é F52-S09).

## Fora de escopo

- Coluna de schema (F52-S01).
- Normalização de upload outbound (voz→ogg/opus, sticker→webp) — isso é a Fase F45, fora desta.
- Endpoint de refresh de signed URL expirada (F52-S06).
- Frontend (estado de erro/retry visual) — F52-S07.

## Arquivos permitidos

- `apps/workers/src/media/**`
- `packages/shared/src/socket-events.ts`

## Arquivos proibidos

- `packages/db/**` · `apps/web/**` · `apps/api/**` · `packages/shared/src/mq/**`

## Contratos de saída

- Socket: `message:media_failed` com `{ conversationId, messageId, reason }` (consumido por F52-S07).
- `messages.media_status` reflete o ciclo de vida real da mídia.

## Definition of Done

- [ ] Teste: download que falha transitoriamente é retentado e conclui (mídia salva, `media_status='ready'`, `media_ready` emitido).
- [ ] Teste: URL expirada → re-resolve URL fresca e baixa; se impossível após retries → `media_status='failed'` + `media_failed` emitido.
- [ ] Teste: dedup SHA-256 preservado (mesmo conteúdo reaproveita key).
- [ ] `message:media_failed` tipado em `socket-events.ts` e na lista server→client.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
pnpm --filter @hm/shared test
```

## Notas

- Re-resolver URL: a Graph API permite `GET /{media-id}` para obter URL temporária fresca; usar isso antes de desistir, pois a URL no webhook é a que mais expira.
- A malha de retry/DLQ de F52-S03 pode ser reaproveitada para o media-worker; coordenar (S03 não toca `media/**`, só a infra `mq/**`).
