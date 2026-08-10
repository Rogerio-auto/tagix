---
id: F58-S14
title: Validar o fluxo completo com 1.000 contatos
phase: F58
status: available
priority: critical
estimated_size: L
depends_on: [F58-S13, F57-S02]
blocks: []
agent_id: qa-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/runbooks/incident-rabbitmq-backlog.md
  - AUDITORIA_TECNICA.md
---

# F58-S14 — Validar o fluxo completo com 1.000 contatos

## Objetivo

Produzir evidência de prontidão, não apenas testes unitários: validar criação,
sincronização de modelos, importação, agendamento, envio, status, pausa e retomada
sob volume representativo.

## Escopo

### files_allowed

- `apps/web/e2e/campaign-builder.spec.ts`
- `apps/api/src/routes/campaigns/**/*.integration.test.ts`
- `apps/workers/src/campaigns/**/*.integration.test.ts`
- `packages/shared/src/mq/**/*.integration.test.ts`
- `scripts/load/campaigns/**`
- `docs/runbooks/campaigns-1000-contacts.md`
- `docs/audits/F58-campaign-readiness.md`

### files_forbidden

- Código de produção fora dos testes/harness; achado vira novo slot, não correção escondida neste QA.

## Definition of Done

- [ ] E2E cobre sincronizar/criar modelo, escolher aprovado, importar público, enviar teste, agendar e monitorar.
- [ ] Harness cria 1.001 recipients sintéticos e mede tempo de import, ticks, lag da fila, duplicatas e uso de memória.
- [ ] Kill/restart de worker e queda/reconexão do RabbitMQ não perdem nem duplicam entrega lógica.
- [ ] Pausa, cancelamento, cota diária e quality RED/YELLOW são exercitados.
- [ ] Nenhuma mensagem real é enviada pelo teste de carga automático; adapter fake registra chamadas/idempotência.
- [ ] Runbook define ramp-up com WABA de staging (25 → 100 → 250 → 500 → 1.000), critérios de abortar e métricas mínimas.
- [ ] Passe manual com WABA real registra evidências de `sent/delivered/read/failed`, 429, DLQ e quality; segredo/telefone ficam redigidos.
- [ ] Auditoria final declara `GO`, `GO com limite` ou `NO-GO` com motivos reproduzíveis.

## Validação

```bash
pnpm --filter @hm/web exec playwright test e2e/campaign-builder.spec.ts
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/shared test
pnpm typecheck
pnpm lint
```

## Notas

- O passe com Meta real é uma etapa operacional manual e exige canal de staging; ausência dessa infraestrutura mantém o resultado em `NO-GO` para produção em massa.
