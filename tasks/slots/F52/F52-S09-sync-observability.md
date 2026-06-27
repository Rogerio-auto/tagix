---
id: F52-S09
title: Observabilidade da sincronização — métricas de tick, profundidade de fila, status WhatsApp
phase: F52
status: available
priority: medium
estimated_size: L
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
  - docs/features/LIVECHAT_OPS.md
---
# F52-S09 — Observabilidade da camada de sincronização

> **Origem:** survey desta sessão. "Logging cego" dos ticks de scheduler (operador não sabe que automations/flows pararam), sem visão de fila/DLQ, sem status da conexão WhatsApp.

## Objetivo

Dar visibilidade operacional ao estado da sincronização: métricas de sucesso/falha dos ticks de scheduler, profundidade das filas (incl. DLQ), e status da conexão com a API do WhatsApp — surfaçado num endpoint + painel simples.

## Contexto

`apps/workers/src/flows/scheduler.ts` e `apps/workers/src/automations/worker.ts` logam erro de tick mas sem métrica/alerta — quando o bug RLS (F40-S01) ou outra falha derruba o tick, ninguém percebe. Não há painel de filas nem de saúde da conexão de canal.

## Escopo (faz)

- **Métricas de tick:** counters de `scheduler_tick_success` / `scheduler_tick_failed` (com label do scheduler) em `scheduler.ts` e `automations/worker.ts` — fim do logging cego.
- **Endpoint de saúde de sync** (`apps/api/src/routes/monitoring/**`, montado em `app.ts`): profundidade das filas principais + DLQ (via RabbitMQ management API), nº de mensagens `pending`/mídia `failed` (consulta agregada), status da conexão de cada canal WhatsApp (quality rating / token).
- **Painel de monitoramento** (`apps/web/features/monitoring/**`): cards de filas, DLQ, ticks, status de canal — gated para admin/platform.
- Log estruturado correlacionável.

## Fora de escopo

- Implementar a DLQ em si (F52-S03) — aqui só lê/expõe.
- Emissão de counters de webhook redelivery (F52-S02) e media failure (F52-S05) — já emitidos lá; aqui só agrega/exibe.
- Corrigir o RLS dos schedulers (F40-S01).

## Arquivos permitidos

- `apps/workers/src/flows/scheduler.ts`
- `apps/workers/src/automations/worker.ts`
- `apps/api/src/routes/monitoring/**`
- `apps/api/src/app.ts`
- `apps/web/features/monitoring/**`

## Arquivos proibidos

- `apps/workers/src/outbound/**` · `apps/workers/src/inbound/**` · `apps/workers/src/media/**` · `packages/shared/src/mq/**` · `apps/web/features/conversations/**`

## Definition of Done

- [ ] Ticks de scheduler emitem counter success/failed; um tick que falha é observável (métrica, não só log).
- [ ] `GET /api/monitoring/sync-health` (admin) retorna profundidade de filas + DLQ + pendências + status de canal.
- [ ] Painel renderiza os indicadores; gated por role (admin/platform).
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Permission scope

Endpoint/painel operacional — restrito a admin/owner/platform-admin. Ver `docs/features/PERMISSIONS.md`. Não expõe dado de tenant cruzado.

## UX considerations (docs/UX_PRINCIPLES.md)

- **Estados explícitos:** cada indicador tem default/loading/error.
- **Densidade informacional sóbria:** painel operacional, dark-first, sem ruído.
- **Sinal acionável:** destacar fila represada / DLQ não-vazia / canal degradado.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Usar a OTel/metrics já configurada (`@hm/logger` / F10-S01 observability) — não introduzir novo stack de métrica.
- Profundidade de fila via RabbitMQ management HTTP API; credenciais já em `.env` da infra.
- Slot L: se ficar grande, o painel web pode virar sub-slot; o backend (métricas + endpoint) é o núcleo.
