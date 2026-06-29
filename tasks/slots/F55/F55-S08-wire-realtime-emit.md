---
id: F55-S08
title: Ligar o emit órfão — dashboard:metric_changed nas mutações reais
phase: F55
status: blocked
priority: medium
estimated_size: S
depends_on: [F55-S04, F55-S02]
blocks: [F55-S09]
agent_id: backend-engineer
source_docs:
  - docs/features/DASHBOARD.md
---
# F55-S08 — Ligar o realtime órfão do dashboard

## Objetivo

Ligar o `emitDashboardMetricChanged` (implementado mas **sem caller**) nos pontos de mutação relevantes,
para que o socket `dashboard:metric_changed` realmente dispare invalidação no front — hoje o dashboard só
atualiza pelo refetch de 5min.

## Contexto

`apps/api/src/services/dashboard/emit.ts:35` publica o envelope em `hm.q.socket.relay`; o evento e o payload
(`DashboardMetricChangedPayload = { workspaceId, metricKey, scope, newValue }`) já existem em
`packages/shared/src/socket-events.ts:207`; o relay reemite para `ws:{id}`; o front
(`useDashboardSocket.ts`) já escuta e invalida. Falta só **chamar o emit** quando a métrica muda.

## Escopo

### files_allowed
- `apps/api/src/services/dashboard/emit.ts` (helpers de conveniência, se úteis — owned por S04, sequencial)
- `apps/api/src/routes/conversations/state.ts` (resolve/close → emit) — owned por S02, sequencial
- `apps/api/src/internal/tools/workflow-handlers.ts` (markResolved/changeStatus → emit) — owned por S02, sequencial
- `apps/api/src/routes/conversions/register.ts` (conversão registrada → emit)
- `apps/api/src/services/dashboard/__tests__/**`

### files_forbidden
- `apps/web/**`, `packages/db/**`, `apps/workers/**` (lead-novo inbound vive no worker — fora; ver nota)

## Escopo (faz)
- Emitir `dashboard:metric_changed` (best-effort, `void emit...`, nunca bloquear/derrubar a mutação) quando:
  - Conversa resolvida/fechada → métricas de SLA/resolvidas/TTR mudam (`scope: {}` e `{memberId}`).
  - Conversão registrada (`registerConversion`) → métricas de conversões/receita/placar mudam.
- `newValue` pode ser um hint leve (o front invalida e refetcha; não precisa carregar valor exato). Manter
  `metricKey`/`scope` coerentes com o que o front observa (conjunto de cards visíveis).
- Best-effort de verdade: erro de fila não pode afetar a transação de negócio.

## Fora de escopo
- "Lead novo" do inbound (insert em `apps/workers/src/inbound/db-ports.ts`) — fora do files_allowed deste
  slot (worker). Fica como follow-up se o feed de leads precisar de push imediato; hoje `leads_recentes` é
  `cadence: socket` e o front já refetcha. Documentar como follow-up BAIXO, não implementar aqui.
- Frontend (já escuta). Definição do evento (já existe).

## Contratos de saída
- `dashboard:metric_changed` passa a ser emitido de fato → `useDashboardSocket` atualiza sem refresh.

## Definition of Done
- [ ] Emit disparado nas mutações de resolve/close (3 caminhos) e em conversão registrada.
- [ ] Best-effort comprovado: falha no publisher não derruba nem reverte a mutação (teste com publisher mock que lança).
- [ ] Teste: emit chamado com `metricKey`/`scope` esperados após cada mutação.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter @hm/api test` verdes.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Espelhar o padrão best-effort de `emit.ts` (catch silencioso) e de `event-realtime.ts`/`deal-events.ts`.
Sequencial após S02 (compartilha state.ts/workflow-handlers.ts) e S04 (emit.ts no dir do serviço).
