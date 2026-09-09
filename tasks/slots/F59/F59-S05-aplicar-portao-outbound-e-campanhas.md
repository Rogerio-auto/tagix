---
id: F59-S05
title: Aplicar o portão no outbound, no agendador e nas tools do agente
phase: F59
status: in-progress
priority: critical
estimated_size: M
depends_on: [F59-S04]
blocks: []
source_docs:
  - docs/features/AGENCIA_PLAN.md
  - docs/features/CAMPAIGNS.md
agent_id: backend-engineer
claimed_at: 2026-09-09T06:06:09Z

---
# F59-S05 — Aplicar o portão no outbound, no agendador e nas tools do agente

## Objetivo

Plugar `decideOutbound` nos três pontos por onde uma mensagem promocional pode sair, de forma que
não exista caminho que escape do portão.

## Contexto

`AGENCIA_PLAN` §4.4 exige o portão em três lugares: worker outbound, agendador de campanha e tools do
agente. Um caminho não coberto anula os outros dois.

## Escopo

### files_allowed

- `apps/workers/src/outbound/job.ts`
- `apps/workers/src/outbound/ports.ts`
- `apps/workers/src/outbound/db-ports.ts`
- `apps/workers/src/outbound/consent-gate.ts`
- `apps/workers/src/outbound/*.test.ts`
- `apps/workers/src/campaigns/tick.ts`
- `apps/workers/src/campaigns/db-ports.ts`
- `apps/workers/src/campaigns/*.test.ts`
- `apps/api/src/routes/agents/tools/**`

### files_forbidden

- `apps/api/src/services/consent/**`
- `packages/**`

## Escopo (faz)

- Worker outbound: antes do dispatch, resolve snapshot e decide. Recusa vira status de mensagem com
  motivo, **não** exceção silenciosa.
- Agendador de campanha: recusa por `quiet_hours` **reagenda** para `retryAt`; recusa por
  `no_consent` ou `suppressed` remove o destinatário da execução e contabiliza.
- Tools do agente que enviam mensagem consultam o mesmo portão.
- Métricas OTel: `hm.outbound.denied{reason,channel,market}`.

## Fora de escopo

- Alterar `decideOutbound` (é de F59-S04 — se faltar caso, escrever em `tasks/COMMS.md`).
- UI de exibição das recusas.

## Definition of Done

- [ ] Nenhum caminho de envio promocional ignora o portão — teste de integração cobre os três pontos.
- [ ] `quiet_hours` reagenda em vez de descartar; teste confirma que a mensagem sai na janela seguinte.
- [ ] Recusa registrada com motivo estável em log estruturado e em métrica.
- [ ] Mensagem transacional (confirmação, lembrete) continua saindo com contato sem opt-in de marketing — teste de regressão explícito, porque quebrar isso derruba a operação do cliente.
- [ ] Campanha existente em base BR continua funcionando sem mudança de comportamento (market `BR` default, sem `requiresPriorConsent` em WhatsApp).
- [ ] `pnpm --filter @hm/workers test` verde, incluindo os testes de campanha já existentes.

## Validação

```bash
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/workers test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
```

## Notas

- **Risco de regressão alto**: este slot toca o caminho de envio em produção. O teste de
  não-regressão do fluxo BR é obrigatório antes do `finish`.
- Recusar silenciosamente é o pior resultado possível: o cliente acha que disparou e não disparou.
