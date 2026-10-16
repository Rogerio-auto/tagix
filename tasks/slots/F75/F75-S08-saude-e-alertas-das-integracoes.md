---
id: F75-S08
title: Saúde por integração — KPIs, erros com causa, registro legível, ações e alertas como notificação
phase: F75
status: blocked
priority: high
estimated_size: M
model: sonnet
depends_on: [F75-S04, F75-S07, F73-S02]
blocks: [F75-S11, F75-S13]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
agent_id: backend-engineer
---
# F75-S08 — Saúde e observabilidade por integração

## Objetivo

Dá para saber em 2 segundos se uma integração está funcionando, devagar ou quebrada; cada erro diz a causa em
português, quantos registros afeta e pode ser reprocessado; dá para sincronizar agora, pausar, retomar e
desconectar sabendo o que para e o que fica; e quando algo quebra, quem pode agir recebe uma notificação.

## Contexto

Maquete B4 (KPIs, erros abertos, volume por hora, registro, modal de desconectar). Spec §4.5. O motor (S04) já
grava execuções/erros e publica jobs `integration.alert` em `hm.q.integrations.alerts`.

## Escopo (faz)

- `apps/api/src/services/integrations/health.ts` + rotas em `apps/api/src/routes/integrations/health.ts`
  (criado vazio pelo S07), schemas em `packages/shared/src/integrations/health.ts`:
  - `GET …/connections/:id/health` (`integration.view`): `status`, `lastSuccessAt`, `nextRunAt`,
    `recordsToday`, `vsAvg7dPct`, `queue { pending, etaSec }`, `errors24h { open, affectedRecords }`,
    `hourly[24] { count, hasError }` (fuso do workspace), `errors[]` (`code`, `cause_pt`, `hint_pt`, amostra,
    `occurrences`), `connectedBy`, `connectedAt`, direções; uma consulta agregada por bloco, com índice; p95 ≤ 150 ms
    com 100 mil execuções;
  - `GET …/connections/:id/log?filter=all|errors|deals&cursor` (`integration.view`): frases legíveis geradas a
    partir de `sync_runs`/`sync_errors`/`inbound_events` ("Pedido #48213 faturado virou negócio ganho: Maria
    Souza, Alinhadores, R$ 6.900."), paginado por cursor, sem PII além do que a pessoa já vê no app;
  - `POST …/errors/:errorId/reprocess`, `POST …/reprocess-all`, `POST …/sync-now` (cooldown 60 s ⇒ `429
    sync_cooldown`), `POST …/pause`, `POST …/resume` (`integration.operate`), publicando jobs do S04 pela outbox;
  - `POST …/disconnect { acknowledged: true }` (`integration.manage`): revoga no provedor quando o conector
    suporta, apaga a credencial do cofre, desativa endpoint de entrada, **pausa as automações (flows) que usam a
    conexão** e devolve `{ pausedAutomations, keptRecords }`; prévia por `GET …/disconnect-preview` com os mesmos
    números para o modal.
  - todas auditadas com `recordIntegrationAudit`.
- Alertas: consumidor na API de `hm.q.integrations.alerts` em `apps/api/src/mq/integration-alerts.ts`, iniciado
  onde o relay de socket sobe (`apps/api/src/socket/index.ts`, uma linha): para cada membro com
  `integration.manage`, `notifyEvent({ evento, eventKey: '<connectionId>:<causa>:<dia>', titulo, url:
  '/integracoes/<slug>' })`. Eventos novos em `packages/shared/src/notifications.ts`: `integracao_falhou`,
  `integracao_reautenticar`, `integracao_parada` (com rótulos PT-BR e padrão de canal como `lead_esfriando`).
- Ponte para o Briefing do Copiloto: `listOpenIntegrationAlerts(workspaceId)` exportado de
  `apps/api/src/services/integrations/health.ts` (a F74 consome; não construir o Briefing aqui).

## Fora de escopo

- UI (S11). Gráficos além das 24 barras.

### files_allowed

- `packages/shared/src/integrations/health.ts`
- `packages/shared/src/notifications.ts`
- `packages/shared/src/notifications.test.ts`
- `apps/api/src/services/integrations/health.ts`
- `apps/api/src/services/integrations/health.test.ts`
- `apps/api/src/services/integrations/disconnect.ts`
- `apps/api/src/services/integrations/disconnect.test.ts`
- `apps/api/src/routes/integrations/health.ts`
- `apps/api/src/mq/integration-alerts.ts`
- `apps/api/src/mq/integration-alerts.test.ts`
- `apps/api/src/socket/index.ts`

## Definition of Done

- [ ] teste: `health` com dados semeados bate com os números da maquete (12 na fila, 3 erros afetando 19)
- [ ] teste: `hourly` no fuso do workspace (virada de dia em `America/Sao_Paulo`)
- [ ] teste: `sync-now` duas vezes em 60 s ⇒ 429; READONLY não reprocessa; AGENT não desconecta
- [ ] teste: desconectar apaga credencial, desativa endpoint, pausa flows que referenciam a conexão e mantém os
      registros importados
- [ ] teste: alerta repetido no mesmo dia não notifica de novo (`eventKey`); só membros com `integration.manage`
- [ ] teste de performance do `health` com 100 mil execuções (p95 ≤ 150 ms no dev)

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/api typecheck
pnpm exec eslint apps/api/src/services/integrations apps/api/src/routes/integrations/health.ts apps/api/src/mq/integration-alerts.ts packages/shared/src/notifications.ts
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/integrations/health.test.ts src/services/integrations/disconnect.test.ts src/mq/integration-alerts.test.ts --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. Como achar os flows que usam a conexão: nó de flow com `integrationConnectionId` no
  config, ou gatilho de evento de integração. Hoje nenhum flow referencia integração: a função existe, devolve 0, e
  tem teste com um flow semeado com a referência.
