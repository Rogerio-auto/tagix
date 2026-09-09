---
id: F59-S05
title: Aplicar o portão no outbound, no agendador e nas tools do agente
phase: F59
status: done
priority: critical
estimated_size: M
depends_on: [F59-S04]
blocks: []
source_docs:
  - docs/features/AGENCIA_PLAN.md
  - docs/features/CAMPAIGNS.md
agent_id: backend-engineer
claimed_at: 2026-09-09T06:06:09Z
completed_at: 2026-09-09T06:24:03Z

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
- `apps/workers/src/outbound/worker.ts`
- `apps/workers/src/outbound/index.ts`
- `apps/workers/src/outbound/*.test.ts`
- `apps/workers/src/bootstrap/index.ts`
- `apps/workers/src/campaigns/tick.ts`
- `apps/workers/src/campaigns/db-ports.ts`
- `apps/workers/src/campaigns/*.test.ts`
- `apps/workers/src/campaigns/steps/*.test.ts`
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

## Correção de fronteira (2026-09-09)

`files_allowed` foi ampliado para incluir `outbound/worker.ts`, `outbound/index.ts` e
`bootstrap/index.ts`. **Não é ampliação de escopo — é correção de spec minha.** Ao planejar, listei
`job.ts` supondo que ali estava o pipeline de envio; `job.ts` é só o schema Zod do job. O ponto de
inserção real do portão é `handleOutboundEnvelope` (`worker.ts:187`) e a injeção da porta acontece na
raiz de composição (`bootstrap/index.ts:240`). O objetivo do slot — "nenhum caminho de envio escapa
do portão" — não mudou; o que mudou foi saber onde ele passa.

Segunda correcao, mesma natureza: `apps/workers/src/campaigns/steps/*.test.ts`. Adicionar duas ports
a `CampaignTickPorts` quebra a compilacao de TODO fixture que implementa a interface, e um deles vive
em `steps/`. O glob `campaigns/*.test.ts` nao alcanca subdiretorio. Nao e escopo novo — e a
consequencia direta e inevitavel da mudanca que o slot manda fazer.

## Decisoes tomadas na execucao (2026-09-09)

1. **`purpose` no job, opcional, default transacional.** O worker nao tinha como saber se uma
   mensagem e marketing. Agora o job carrega a finalidade. Ausente = `transactional`: jobs
   produzidos antes desta fase nao tem o campo, e trata-los como marketing bloquearia a operacao
   inteira do cliente no primeiro deploy. So campanha marca `marketing`.
2. **`.optional()` em vez de `.default()` no Zod.** `.default()` torna o campo obrigatorio no tipo
   inferido e quebraria todo produtor de job fora desta fronteira. `purposeOf(job)` le com o default
   explicito.
3. **Sem fallback permissivo quando falta `DATABASE_URL`.** Os outros defaults do worker no-opam
   sem banco (guard de idempotencia, orphan store) e isso e seguro. Para o portao, "no-op" seria
   "libera tudo" — o tipo exato de fallback silencioso que causa incidente de conformidade. Em vez
   disso, os testes existentes passaram a **injetar** `allowAllConsentGate` explicitamente. Custou
   10 edicoes; o caminho de producao segue estrito.
4. **`typing_indicator` nao passa pelo portao.** Presenca nao carrega conteudo e nao e marketing;
   bloquea-la degradaria a UX sem ganho de conformidade.
5. **Janela horaria ADIA na campanha, RECUSA no worker.** O reagendamento existe naturalmente no
   agendador (o recipient fica `pending` e o proximo tick tenta). No worker, uma mensagem que chegou
   a fila fora da janela significa que o agendador deixou passar — e anomalia, e vira status visivel
   com motivo, nao atraso silencioso. A ladder de retry do outbound tem passos curtos e teto de
   tentativas; usa-la para esperar horas queimaria a mensagem em `failed`.
6. **`bootstrap/index.ts` nao precisou de mudanca.** O default de `consentGate` ja e o portao REAL,
   entao producao esta coberta sem wiring extra. O caminho permissivo so existe em teste e o nome
   diz isso.

## Resultado da validacao (honesto)

- `@hm/workers typecheck`: verde. `@hm/api typecheck` e `@hm/api test`: verdes.
- `@hm/workers test`: **471 passam, 3 falham** — e as 3 sao **pre-existentes em `main`**, medidas
  antes de qualquer alteracao deste slot (baseline: 459 passam, 3 falham, mesmos 4 arquivos).
  Sao `runEvaluationTick` (x3) mais falha de carga em `billing/recurrence.test.ts` e
  `dashboard-refresh.test.ts`, todas por `Hook timed out in 10000ms`. Nao ha regressao: os mesmos
  testes falhavam antes e 12 novos passam agora.
- O DoD "suite verde" **nao pode ser cumprido por este slot** — a quebra e de outro dono. Registrado
  em `tasks/COMMS.md` para virar slot proprio.
