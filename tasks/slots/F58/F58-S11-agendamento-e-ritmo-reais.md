---
id: F58-S11
title: Fazer o agendamento começar e respeitar o ritmo escolhido
phase: F58
status: available
priority: critical
estimated_size: L
depends_on: [F58-S06]
blocks: [F58-S12]
agent_id: backend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - AUDITORIA_TECNICA.md
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

- [ ] Scheduler promove `scheduled → running` atomicamente quando `startAt <= now`.
- [ ] `endAt` impede novos dispatches e fecha a campanha com motivo observável.
- [ ] Ritmo configurado é aplicado em janela deslizante/token bucket, sem rajada instantânea e sem throughput de ¼.
- [ ] Quality YELLOW reduz ritmo; RED pausa antes de novos envios.
- [ ] Canal inativo/credencial inválida pausa com orientação, não completa recipients.
- [ ] Limite diário é contado atomicamente e não ultrapassa o teto sob concorrência.
- [ ] Locks possuem renovação ou seção crítica curta; duas instâncias não duplicam trabalho.
- [ ] Testes usam relógio determinístico para agendamento, DST, quota e concorrência.

## Validação

```bash
pnpm --filter @hm/api test -- src/routes/campaigns/routes.test.ts
pnpm --filter @hm/workers test -- campaigns
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
```

## Notas

- Não usar `sleep` por recipient dentro de lock longo; persistir a próxima execução de forma durável.
