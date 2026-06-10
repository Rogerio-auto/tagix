---
id: F2-S21
title: Auto follow-up cron job idempotente
phase: F2
status: blocked
priority: low
estimated_size: S
depends_on: [F2-S11]
---

# F2-S21 — Auto follow-up cron

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §4; `docs/ROADMAP.md` F2-S21
> **blocks:** —

## Objetivo
Job agendado que dispara follow-ups automáticos: encontra conversas elegíveis (ex.: sem resposta há X, agente `follow_up` ativo, dentro da janela do canal) e enfileira um run de agente para reengajar — idempotente (não dispara duas vezes a mesma janela).

## Escopo (faz)
- `apps/workers/src/agents/followup.ts`: query de conversas elegíveis (RLS por workspace), guarda de idempotência (marca último follow-up), enfileira agent-run (reusa F2-S11). Registrado no scheduler.

## Fora de escopo
- O run em si (F2-S11), buffer (F2-S12), campanhas (F4/CAMPAIGNS).

## Arquivos permitidos
- `apps/workers/src/agents/followup.ts`

## Definition of Done
- [ ] Seleciona elegíveis corretamente; respeita janela 24h do canal (F1-S17).
- [ ] Idempotente: re-run no mesmo período não duplica follow-up.
- [ ] `pnpm --filter @hm/workers typecheck`/lint/test verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
Scheduler singleton via Redis lock (ARCHITECTURE §1 — scheduler). Wiring no bootstrap de workers (F1-S26) = orchestrator.
