---
id: F73-S13
title: Piloto automático do pipeline, backend (regras por estágio, gerador determinístico de sugestões, aprovar ou recusar em lote via motor)
phase: F73
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: false
depends_on: [F73-S01, F73-S02, F73-S03, F73-S05, F73-S08]
blocks: [F73-S14, F73-S16, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/features/PIPELINE.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
agent_id: backend-engineer
---
# F73-S13 — Piloto automático (backend)

## Objetivo

Cada estágio do pipeline pode ter um nível de autonomia: desligado, **só sugerir** ou **aprovação diária**. Um gerador determinístico propõe movimentações com motivo em linguagem de negócio e confiança visível. Aprovar (uma, várias ou "todas de alta e média") executa pelo motor de propostas como quem aprovou, com desfazer por 7 dias. "Mover sozinho" fica **fora** (v1.1, F73-S16).

## Contexto

A9 da maquete; regras na spec §7.2. As decisões em aberto do Rogério ("mover sozinho" na v1 ou v1.1) são resolvidas assumindo v1.1: o banco aceita `mode='auto'` e a API recusa. O gatilho para liberar é por dado (spec §9).

## Escopo (faz)

- Gerador em `packages/db/src/copilot/autopilot/**` (preenche o stub do S01; roda no worker; puro SQL + regras):
  - `generateSuggestions(tx, workspaceId, now)`: para cada regra com `mode ∈ {suggest, daily_approval}`, os negócios abertos no estágio com `dealIdleDaysSql() ≥ criteria.idle_days` e, se `criteria.require_last_outbound`, última mensagem nossa (`dealLastMessageDirectionSql() = 'outbound'`). Insere `copilot_suggestions` pendentes com `insertSuggestionIfAbsent`; expira as pendentes cujo negócio saiu do estágio ou voltou a conversar (`superseded`/`expired`).
  - `reason.ts`: motivo por modelo de texto ("Sem resposta há 9 dias; a última mensagem foi nossa, em 07/10"). Nunca número de score.
  - `confidence.ts`: `high|medium|low` pela posição de `idle_days` frente ao p50 e p90 do tempo no estágio dos negócios **ganhos** nos últimos 180 dias (acima do p90 = high; entre p50 e p90 = medium; abaixo = low; menos de 10 ganhos = medium fixo, com motivo "pouco histórico").
- Worker `apps/workers/src/copilot-autopilot/**`: tick de hora em hora com lock Redis (`acquireSchedulerLock`), por workspace com regra ativa, em lotes; emite `copilot:suggestions_changed` (contagem) pela fila `socket.relay`, no mesmo padrão de `makeRelayEmitter` em `apps/workers/src/automations/create-event-port.ts` (best-effort, sem derrubar o tick). Registrado no bootstrap dos workers (`apps/workers/src/bootstrap/index.ts`).
- API `apps/api/src/services/copilot/autopilot/**` + `apps/api/src/routes/copilot/autopilot/**`:
  - `GET /api/copilot/autopilot/rules` (`pipeline.view`) e `PUT` (`copilot.autopilot.manage`): valida `target_stage_id` do mesmo pipeline, `idle_days 1..60` e `daily_limit 1..50`; `mode='auto'` → `409 feature_not_available` (v1.1); `audit_logs` "Ligado por Bruna em 10/10";
  - `GET /api/copilot/suggestions?status=pending&stage_id=` (`pipeline.view`, filtrado por `dealScope` do membro), com o negócio resumido, motivo, confiança e destino;
  - `POST /api/copilot/suggestions/decide` (`{ ids ≤ 200, decision }`):
    - `approve` cria **uma** proposta `source='autopilot'`, capacidade `deal.move`, pelo executor do F73-S08, executada na hora pelo motor como o aprovador (o clique de aprovar é a confirmação), com `undo_deadline` de 7 dias; as sugestões ficam `approved` com o `proposal_id`;
    - `reject` → `rejected`;
    - sugestão de negócio fora do escopo do membro → `not_found` nesse item.
    O resultado traz "aprovadas 7, puladas 1 (editada por Paula)".
  - Itens `low` não são aprovados por "aprovar todos" a menos que venham listados explicitamente em `ids` (a interface decide; o backend aceita o que vier, com permissão).
- O briefing (F73-S12) já lê as pendentes de `daily_approval`: nada a fazer lá.

## Fora de escopo

- `mode='auto'` executando sozinho, limite diário aplicado e "Ver o que ele moveu" (F73-S16, v1.1).
- Sugestões baseadas em conteúdo de mensagem, como "Disse que fechou com outra clínica" → Perdido: exigem LLM sobre texto de cliente (v1.1, com contaminação).
- Interface (F74-S11).

### files_allowed

- `packages/db/src/copilot/autopilot/**`
- `apps/workers/src/copilot-autopilot/**`
- `apps/workers/src/bootstrap/index.ts`
- `apps/api/src/services/copilot/autopilot/**`
- `apps/api/src/routes/copilot/autopilot/**`

### files_forbidden

- `packages/db/src/schema/**`
- `apps/api/src/internal/copilot/act-crm/**` (executor; só importar)

## Definition of Done

- [ ] Gerador com teste no banco de dev: cria, não duplica, expira quando o negócio sai do estágio ou o cliente responde; motivo e confiança corretos em casos calculados à mão
- [ ] Worker com lock testado (dois ticks simultâneos → um processa)
- [ ] `decide/approve` executa pelo motor como o aprovador, com desfazer por 7 dias (teste lendo `copilot_action_proposals.undo_deadline` e `audit_logs.actor_type='autopilot'`)
- [ ] `PUT rules` com `mode='auto'` → 409; sem `copilot.autopilot.manage` → 403
- [ ] AGENT só vê e decide sugestões de negócios no seu escopo

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/copilot/autopilot --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/copilot-autopilot --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/copilot/autopilot src/routes/copilot/autopilot --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- Taxa de aceite (aprovadas ÷ decididas) por estágio é a métrica que decide a v1.1. A F73-S15 a expõe; aqui basta que `decided_at` e o status estejam certos.
