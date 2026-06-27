---
id: F52-S03
title: DLX + retry exponencial + DLQ inspecionável para inbound/outbound/media
phase: F52
status: available
priority: critical
estimated_size: M
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
---
# F52-S03 — DLX, retry e DLQ reais

> **Origem:** survey desta sessão. Fragilidade CRÍTICA: `nack` descarta mensagens silenciosamente — `hm.dlx` declarada mas nenhuma fila roteia para ela (`topology.ts:108`).

## Objetivo

Tornar o consumo das filas de mensageria resiliente: falha transitória de processamento (DB indisponível, erro de infra) **não pode descartar** a mensagem. Implementar dead-letter routing com retry exponencial e uma DLQ final inspecionável.

## Contexto / causa raiz (confirmada)

`packages/shared/src/mq/topology.ts:105-108`: a exchange `hm.dlx` existe mas nenhuma fila a usa. Em `packages/shared/src/mq/index.ts` o `consume` faz `channel.nack(msg, false, false)` em erro → **sem requeue, sem dead-letter** → mensagem perdida. Afeta inbound (mensagens de cliente perdidas se DB pisca), outbound e media.

## Escopo (faz)

- **Rotear `hm.q.inbound`, `hm.q.outbound`, `hm.q.media`** (confirmar nomes reais na topology) para `hm.dlx` via `x-dead-letter-exchange`.
- **Retry com backoff exponencial:** mensagem que falha vai para fila de espera (delay via TTL + DLX, ou plugin de delay se disponível) e retorna para reprocessamento, com limite de tentativas (ex.: 5) e header de contagem.
- **DLQ final inspecionável** (`hm.q.dlq` ou por-fila) onde a mensagem para após esgotar retries — não descartada; consultável por operação.
- Distinguir **erro de conteúdo** (payload inválido, provider desconhecido — não retentável, vai direto pra DLQ com motivo) de **erro transitório** (retentável).
- Atualizar o helper `consume` para suportar a política (ou expor opção) sem quebrar consumers atuais.
- Métricas/log estruturado de: retries, mensagens em DLQ, motivo.

## Fora de escopo

- Mudar a lógica de negócio dos workers (parsing, persistência) — só a malha de entrega.
- Webhook publish-side (é F52-S02).
- UI de inspeção da DLQ (a observabilidade visual é F52-S09; aqui só a fila existe e é consultável).

## Arquivos permitidos

- `packages/shared/src/mq/**`
- `apps/workers/src/dlq/**`

## Arquivos proibidos

- `apps/api/**` · `packages/db/**` · `apps/workers/src/inbound/**` · `apps/workers/src/outbound/**` · `apps/workers/src/media/**`

## Contratos

- `consume(channel, queue, handler, opts?)` ganha política de retry/DLX configurável, default seguro.
- Toda fila de mensagem nasce com `x-dead-letter-exchange` apontando para `hm.dlx`.

## Definition of Done

- [ ] Teste: handler que lança erro transitório N vezes → mensagem é retentada com backoff e processa quando o handler para de falhar (não perdida).
- [ ] Teste: erro persistente além do limite de tentativas → mensagem termina na DLQ (consultável), não descartada.
- [ ] Teste: erro de conteúdo (não retentável) → vai direto pra DLQ com motivo, sem N retries.
- [ ] Topology assertions idempotentes no boot; consumers existentes continuam funcionando.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/shared test
```

## Notas

- RabbitMQ não tem delay nativo; o padrão é **dead-letter + TTL por nível de retry** (filas de espera `hm.q.retry.5s/30s/...`) ou o plugin `rabbitmq_delayed_message_exchange` se presente no broker de prod. Confirmar o que a infra (`infra/docker`) oferece antes de escolher.
- Cuidado: o ack/nack atual é manual; manter a semântica para os handlers que já tratam erro de conteúdo ack'ando (não regredir).
- Coordenar nomes de fila com a topology existente; não renomear filas em produção sem migração.
