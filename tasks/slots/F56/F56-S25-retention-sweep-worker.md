---
id: F56-S25
title: Retenção — sweep de webhook_events + base de retenção
phase: F56
status: done
priority: medium
estimated_size: S
depends_on: []
blocks: [F56-S17]
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-17T22:53:27Z

---
# F56-S25 — Worker de retenção (DB-02)

> **Origem:** AUDITORIA_TECNICA.md §3.8. `webhook_events` promete retenção de 30d que não existe (comentário + índice "para o sweep", sem sweep) — a tabela mais quente de escrita cresce sem limite.

## Objetivo

Estancar o crescimento de `webhook_events` com um sweep de retenção, provendo a base reutilizável para futuras políticas (llm_usage_logs, tool_logs, flow_logs).

## Contexto / causa raiz (verificada)

`packages/db/src/schema/webhook_events.ts:28-29` — índice `idx_webhook_events_received` "para o sweep"; grep de sweep/retention/purge em workers = 0.

## Escopo (faz)

- Worker/scheduler `apps/workers/src/retention/**` (singleton via lock Redis): `DELETE FROM webhook_events WHERE received_at < now() - interval '30 days'` diário, em lotes.
- Exportar `startRetentionWorker()` (registrado no bootstrap por F56-S17 — não editar `main.ts`/`bootstrap` aqui).
- Garantir/ajustar o índice em `webhook_events` para o range de `received_at`.

## Escopo (não faz)

- Partição de `messages`/`agent_executions` (DB-01, follow-up grande). Wiring no bootstrap (F56-S17).

## Arquivos permitidos

- `apps/workers/src/retention/**`
- `packages/db/src/schema/webhook_events.ts`
- `packages/db/drizzle/0065_f56_webhook_events_retention.sql`

## Arquivos proibidos

- `apps/workers/src/main.ts` · `apps/workers/src/bootstrap/**` (F56-S17) · `packages/db/drizzle/meta/**`

## Definition of Done

- [ ] Sweep remove linhas > 30d em lotes, idempotente (teste com dados sintéticos).
- [ ] `startRetentionWorker()` exportado para o bootstrap consumir.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Deletar em lotes (LIMIT + loop) para não travar a tabela quente. `meta/_journal.json` regenerado pelo integrador.
