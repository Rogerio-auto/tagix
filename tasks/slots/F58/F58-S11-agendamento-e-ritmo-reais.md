---
id: F58-S11
title: Fazer o agendamento começar e respeitar o ritmo escolhido
phase: F58
status: done
priority: critical
estimated_size: L
depends_on: [F58-S06]
blocks: [F58-S12]
agent_id: backend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - AUDITORIA_TECNICA.md
claimed_at: 2026-10-07T17:13:00Z
completed_at: 2026-10-07T17:53:46Z

---
# F58-S11 — Fazer o agendamento começar e respeitar o ritmo escolhido

## Objetivo

Fechar a diferença entre o que a tela promete e o worker executa: campanha
agendada deve iniciar sozinha, parar no prazo e distribuir envios ao longo do
tempo em vez de criar rajadas de `rate/4` uma vez por minuto.

## Escopo

### files_allowed

- `apps/api/src/routes/campaigns/lifecycle.ts`
- `apps/api/src/routes/campaigns/crud.ts`
- `apps/workers/src/campaigns/tick.ts`
- `apps/workers/src/campaigns/rate.ts`
- `apps/workers/src/campaigns/scheduler.ts`
- `apps/workers/src/campaigns/db-ports.ts`
- `apps/workers/src/campaigns/**/*test.ts`

### files_forbidden

- `apps/web/**`
- `packages/shared/src/mq/**`
- `packages/db/src/schema/**`

## Definition of Done

- [x] Scheduler promove `scheduled → running` atomicamente quando `startAt <= now`.
  `promoteScheduledCampaigns`: UPDATE condicional único (`WHERE status='scheduled' AND start_at <= now`)
  + `audit_logs campaign.started` na mesma transação. Prova: `schedule-pacing.db.test.ts` (duas
  instâncias em `Promise.all` → 1 promoção, 1 auditoria; a futura continua `scheduled`).
- [x] `endAt` impede novos dispatches e fecha a campanha com motivo observável.
  Três camadas: tick fecha antes de olhar canal; portão por mensagem recusa `ended` sob lock;
  `scheduleNextTick` usa `least(..., end_at)` (acorda NO prazo). Fecha `completed` + `audit_logs`
  `{reason:'end_at_reached', message, notReached}`; quem sobrou vira `failed campaign_end_reached`.
- [x] Ritmo configurado é aplicado em janela deslizante/token bucket, sem rajada instantânea e sem throughput de ¼.
  GCRA com cursor durável em `next_tick_at`; scheduler a cada 5s; balde = 5s de ritmo + 1.
  Simulação 10 min a 1/7/30/60/120/600 por minuto: vazão ≥ 97% do ritmo, nunca acima de
  `ritmo + balde` em qualquer minuto deslizante (`drip.test.ts`).
- [x] Quality YELLOW reduz ritmo; RED pausa antes de novos envios.
  YELLOW → rate/2 chega à reserva (`tick.test.ts`; simulação 60→30/min em `drip.test.ts`).
  RED pausa antes de `pendingRecipients`. Quality em cache por canal (60s) — a Graph não é chamada a cada 5s.
- [x] Canal inativo/credencial inválida pausa com orientação, não completa recipients.
  `inspectChannel`: `channel_inactive | channel_not_found | channel_credentials_missing |
  channel_credentials_invalid` (segredo ilegível, Graph 190/10/200/401/403) → `paused` + orientação
  em `audit_logs`; reaper/lote/settle não rodam. Meta fora do ar (5xx/rede) → `unavailable`, sem
  pausar, tenta em 60s. HTTP à Graph agora FORA da transação.
- [x] Limite diário é contado atomicamente e não ultrapassa o teto sob concorrência.
  Reserva por mensagem (`decideDispatchGate`, puro) sob `SELECT ... FOR NO KEY UPDATE` na mesma
  transação da entrega; reset de virada de dia feito na própria reserva; `ensureDailyQuota` virou
  só leitura (o reset sem lock podia zerar envios contados por outra instância). Prova: 8 dispatches
  simultâneos, teto 3 → exatamente 3, os 5 recusados sem claim/attempt gasto.
- [x] Locks possuem renovação ou seção crítica curta; duas instâncias não duplicam trabalho.
  Lock do scheduler renovado (heartbeat TTL/3, Lua que só estende o próprio token); renovação
  perdida aborta o tick via `AbortSignal` (não começa campanha/mensagem nova; não apaga lock
  alheio). Seção por campanha curta por construção (lote ≤ balde). Mesmo sem lock, reserva +
  claim + idempotency key no Postgres impedem duplicidade.
- [x] Testes usam relógio determinístico para agendamento, DST, quota e concorrência.
  `now` sempre injetado; DST America/New_York 08/03/2026 (dia de 23h) em `rate.test.ts` e
  `drip.test.ts`; concorrência real contra Postgres em `schedule-pacing.db.test.ts`.

## Entrega (F58-S11)

### Arquivos
- `apps/workers/src/campaigns/rate.ts` — GCRA (`planPace`, `pacingIntervalMs`, `pacingBurst`) e
  portão por mensagem `decideDispatchGate` (status > prazo > teto > compasso). Puro.
- `apps/workers/src/campaigns/tick.ts` — promoção no início do tick; prazo; `inspectChannel`;
  lote = créditos do compasso; desfechos `gate_closed`; `deferRecipient` para janela do contato;
  `describeStopReason` (orientação ao cliente por motivo); `AbortSignal` de liderança.
- `apps/workers/src/campaigns/scheduler.ts` — varredura 5s, lease com renovação/abort.
- `apps/workers/src/campaigns/db-ports.ts` — `promoteScheduledCampaigns`, `inspectChannel`
  (cache de quality, HTTP fora da tx), `reserveDispatch` (FOR NO KEY UPDATE), `closeCampaign`,
  `deferRecipient`, `pauseCampaign`/`settleCampaign` com `audit_logs`, `scheduleNextTick`
  `least(greatest(cursor, at), end_at)`, `listDueCampaigns` sem N+1. Removido `recordDailyUsage`.
- `apps/api/src/routes/campaigns/lifecycle.ts` — activate/resume recusam prazo vencido
  (`campaign_ended`); activate recusa fim ≤ início; pause só de `running|scheduled` (409 nos
  demais); resume com início futuro volta a `scheduled`; ordem de locks recipient→campanha;
  auditoria das ações da pessoa.
- `apps/api/src/routes/campaigns/crud.ts` — fim > início no create e no update (contra o valor
  gravado); `GET /api/campaigns/:id` devolve `statusReason {action, actor, reason, message, at}`.
- Testes: `rate.test.ts`, `scheduler.test.ts`, `schedule-pacing.db.test.ts` (novos);
  `tick.test.ts`, `steps/drip.test.ts`, `conversation-opened.test.ts` (atualizados).

### Decisões
- **Sem migration.** `packages/db/src/schema/**` é proibido neste slot. O cursor do compasso reusa
  `next_tick_at`; o motivo observável vai para `audit_logs` (actor `system`/`member`, metadata
  `{reason, message}`) e a API expõe o último em `statusReason`. Uma coluna `status_reason` seria
  mais barata de ler; fica como sugestão para quem puder tocar o schema.
- **`FOR NO KEY UPDATE`, não `FOR UPDATE`.** O INSERT em `campaign_deliveries` (FK → campaigns)
  segura KEY SHARE na linha; `FOR UPDATE` deadlockava dois dispatches simultâneos (reproduzido no
  teste de concorrência antes da correção).
- **Balde acorda vazio** após sono longo (janela/cota/agendamento): a 1ª mensagem sai na hora e o
  ritmo pleno vem na varredura seguinte — nada de rajada na virada do dia.
- **Recipients do prazo vencido** viram `failed campaign_end_reached` (contáveis no relatório),
  não ficam `pending` numa campanha concluída.
- `batchSizeForTick` mantido como `@deprecated` só porque `campaigns/index.ts` (fora da fronteira)
  ainda o reexporta.

### Validação (local, Postgres/Redis dev com `.env` da raiz)
- `@hm/workers`: suíte inteira 83 arquivos / 836 testes verdes; `campaigns`: 12 arquivos / 177.
- `@hm/api` `src/routes/campaigns`: 12 arquivos / 140 verdes; suíte inteira 1645/1646 — a única
  falha (`accounts-journey.integration.test.ts`) é ambiental: o teste sobe `tsx --env-file=<worktree>/.env`
  e a worktree não tem `.env`.
- Rotas novas da API verificadas com teste supertest temporário (5/5: create/update fim ≤ início
  → 400; activate com prazo vencido → 422; pause de rascunho → 409; resume prazo vencido → 409;
  resume com início futuro → `scheduled`; `statusReason` no GET). Não commitado: os arquivos de
  teste da API estão fora de `files_allowed` — cobertura permanente fica para o F58-S14 (QA).
- `typecheck` api/workers e `eslint` limpos.
- `slot.py validate` reprova os dois comandos de teste por ambiente: o pnpm 11 repassa o `--`
  literal ao vitest (roda a suíte inteira) e o shell do validate não carrega `DATABASE_URL`, então
  testes de outros domínios que exigem banco falham. Com o `.env` carregado, tudo verde (acima).

## Validação

```bash
pnpm --filter @hm/api test -- src/routes/campaigns/routes.test.ts
pnpm --filter @hm/workers test -- campaigns
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
```

## Notas

- Não usar `sleep` por recipient dentro de lock longo; persistir a próxima execução de forma durável.
