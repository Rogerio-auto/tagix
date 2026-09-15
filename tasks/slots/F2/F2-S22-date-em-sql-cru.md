---
id: F2-S22
title: Date em SQL cru quebrava rollup de métricas, cobrança PIX e agendadores — correção no cliente do banco
phase: F2
status: available
priority: critical
estimated_size: S
depends_on: [F2-S13]
blocks: []
source_docs:
  - docs/INDEX.md
agent_id: backend-engineer

---
# F2-S22 — Date em SQL cru quebrava rollup de métricas, cobrança PIX e agendadores

## Objetivo

Todo `Date` passado como parâmetro em `sql` cru funciona, em qualquer lugar do código — corrigido
uma vez no cliente do banco, não caso a caso — e um teste contra Postgres real impede a volta.

## Contexto

Encontrado em 2026-09-15, na verificação de produção da F69-S03. O log dos workers mostrava
"falha no rollup de métricas de agentes" a cada 10 minutos (45 vezes desde o deploy das 06:15) e
"billing-recurrence: tick falhou" a cada hora.

**Causa, confirmada no código das duas bibliotecas:** o driver `drizzle-orm/postgres-js` troca o
serializador dos tipos de data do postgres.js (`1184`, `1114`, `1082`…) por um repasse sem
conversão. As colunas tipadas não sentem, porque o Drizzle converte `Date` em texto antes. Mas um
`${data}` dentro de `sql` cru não passa por coluna: o postgres.js infere `1184` para o `Date`,
aplica o repasse e tenta escrever o objeto no protocolo — `TypeError: The "string" argument must be
of type string ... Received an instance of Date`. Reproduzido contra Postgres local.

O teste do rollup passava porque mockava `@hm/db` — nunca chegou a um driver de verdade.

**Onde quebra** (busca por nome; pode haver mais — por isso a correção é no cliente):

| Local | Efeito | Produção hoje |
|---|---|---|
| `apps/workers/src/agents/metrics.ts` (3 consultas) | métricas de agente nunca calculadas | falha a cada 10 min; 0 uso de IA nos últimos 33 dias |
| `apps/workers/src/billing/recurrence.ts` | cobrança PIX do próximo ciclo e régua de inadimplência nunca rodam | falha a cada hora; 0 assinatura PIX (1 trial de cartão) |
| `apps/workers/src/agents/followup.ts` | follow-up automático do agente não dispara | latente: 0 agente de follow-up |
| `apps/workers/src/agents/reengagement.ts` | IA não retoma conversa depois do atendente | latente: 0 conversa pausada |
| `apps/api/src/routes/conversations/index.ts` (`before`) | paginação de mensagens antigas daria 500 | latente: nenhum cliente envia `before` |

Nenhum dinheiro ou lead perdido ainda. O primeiro cliente PIX, o primeiro agente de follow-up ou a
primeira retomada de IA seriam.

## Escopo

### files_allowed

- `packages/db/src/client.ts`
- `packages/db/src/client-date-params.test.ts`

### files_forbidden

- `apps/**` — a correção é no cliente; os pontos de chamada ficam como estão (os que já mandam ISO
  continuam funcionando).

## Escopo (faz)

- Depois do `drizzle()`, devolver aos tipos de data um serializador que converte **só** `Date` em
  ISO e repassa o resto sem tocar. Texto que o Drizzle manda das colunas tipadas continua intacto
  (preserva microssegundos que um `Date` perderia).
- Não mexer nos *parsers*: o Drizzle espera texto de volta.
- Teste contra Postgres real: `Date` em `sql` cru nas formas usadas pelo código (comparação,
  aritmética com `make_interval`, `between`), e ida e volta de coluna tipada com microssegundos.

## Definition of Done

- [ ] `Date` em `sql` cru funciona contra Postgres real (teste).
- [ ] Coluna `timestamptz` tipada continua gravando e lendo igual, com microssegundos (teste).
- [ ] Rollup de métricas e recorrência de cobrança param de falhar no log de produção.
- [ ] Suítes de `@hm/db`, `@hm/workers` e `@hm/api` verdes.

## Validação

```bash
pnpm --filter @hm/db test
pnpm --filter @hm/workers test
pnpm --filter @hm/api test
pnpm typecheck
pnpm lint
```
