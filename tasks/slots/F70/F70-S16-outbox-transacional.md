---
id: F70-S16
title: Outbox transacional para eventos de domínio e jobs, com dedup indexado dos webhooks
phase: F70
status: in-progress
priority: high
estimated_size: L
depends_on: [F70-S14, F70-S12]
blocks: [F70-S17]
source_docs:
  - tasks/slots/F70/F70-S09-ligar-os-webhooks-de-saida.md
  - tasks/slots/F70/F70-S14-eventos-completos-de-lead-ads-e-campanha.md
agent_id: backend-engineer
claimed_at: 2026-09-25T05:22:14Z

---
# F70-S16 — Outbox transacional para eventos de domínio e jobs, com dedup indexado dos webhooks

## Objetivo

Nenhum evento de domínio nem job de outbound se perder, ou sair de uma transação que não aconteceu. Hoje a publicação vem depois do commit: se o processo cair entre os dois, o aviso some, e a delivery de campanha fica `queued` sem job.

## Escopo

### files_allowed

- `packages/db/drizzle/**` *(migração 0086)*
- `packages/db/src/schema/outbox.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/webhooks.ts`
- `packages/db/src/outbox*.ts`
- `packages/db/src/index.ts`
- `packages/shared/src/mq/**`
- `apps/workers/src/outbox/**`
- `apps/workers/src/bootstrap/index.ts`
- `apps/workers/src/webhooks/**`
- `apps/workers/src/leadgen/**`
- `apps/workers/src/campaigns/**`
- `apps/workers/src/coexistence/**`
- `apps/workers/src/inbound/db-ports.ts`
- `apps/workers/src/outbound/finalize.ts`

## Escopo (faz)

- Tabela `outbox` (migração 0086): evento ou job, routing, payload, `event_id` único, estado, tentativas, `available_at`. Sem RLS de tenant (é infraestrutura do sistema): acesso só pelo papel dos workers, com GRANT explícito e documentado.
- `enqueueOutbox(tx, message)` em `@hm/db`: grava na mesma transação do dado.
- Relay em `apps/workers/src/outbox`:
  - lê com `FOR UPDATE SKIP LOCKED` dentro de transação e publica com publisher confirms;
  - marca como enviado, com backoff e tentativas máximas;
  - publica pelo menos uma vez, com dedup no consumidor pelo `event_id`;
  - acorda por `LISTEN/NOTIFY` ou por polling curto;
  - limpa o que já foi enviado.
- Produtores dos workers migrados para o outbox: leadgen, campaigns (incluindo o job de outbound; a compensação da S14 deixa de ser necessária), coexistence, inbound, outbound/finalize.
- Índice único `(webhook_id, (payload #>> '{_meta,eventId}'))` em `outbound_webhook_deliveries`; o fan-out usa `ON CONFLICT DO NOTHING` no lugar da varredura com advisory lock.

## Fora de escopo

- Produtores da API (F70-S17, depois da F70-S11).

## Definition of Done

- [x] teste: rollback → nada no outbox e nada publicado
- [x] teste: processo "cai" depois do commit (relay parado) → ao voltar, o evento é publicado
- [x] teste: broker fora → tentativas com backoff, depois entrega
- [x] teste: dois relays em paralelo → cada mensagem publicada uma vez em condições normais
- [x] teste: fan-out dedup pelo índice

## Decisões

### Acesso à tabela `outbox` (segurança)

A outbox guarda linhas de todos os workspaces, e o payload pode ter texto de mensagem. Nenhum
tenant lê nada dela. O acesso é controlado por privilégio, com uma RLS só de gravação como
defesa em profundidade (migração 0086):

| Papel | Privilégio | Por quê |
| --- | --- | --- |
| `hm_app` (API e `withWorkspace` dos workers) | `INSERT` + `SELECT (event_id)` | O produtor grava na transação dele, que roda como `hm_app`. O `ON CONFLICT (event_id) DO NOTHING` exige SELECT na coluna árbitro e, com RLS, aplica a policy de SELECT à linha nova. |
| `hm_outbox_relay` (NOLOGIN) | `SELECT, INSERT, UPDATE, DELETE` | O relay lê, marca e limpa. Concedido ao papel que roda a migração, que é o papel de conexão dos workers hoje (`PG_USER`, dono da tabela). |
| `PUBLIC` | nada | — |

- A migração faz `REVOKE ALL ... FROM hm_app`, porque o `ALTER DEFAULT PRIVILEGES` da 0001 daria
  SELECT/INSERT/UPDATE/DELETE ao `hm_app` em toda tabela nova, e só então concede o INSERT.
- RLS `ENABLE` + `FORCE`:
  - `outbox_tenant_insert`: `FOR INSERT TO hm_app WITH CHECK (workspace_id = app_current_workspace())`.
    Um handler com bug não enfileira evento de outro tenant.
  - `outbox_tenant_select`: `FOR SELECT TO hm_app USING (workspace_id = app_current_workspace())`.
    É exigida pelo ON CONFLICT e, junto do grant por coluna, deixa o `hm_app` ver no máximo os
    `event_id` do próprio workspace. Payload, destino e estado ficam fora do alcance, e nenhum
    outro workspace aparece.
  - `outbox_relay_all`: `FOR ALL TO hm_outbox_relay USING (true)`.
- O enqueue não usa RETURNING, que exigiria SELECT em todas as colunas.
- A F70-S17 não precisa de grant novo: os produtores da API gravam pelo mesmo `hm_app`.
- Se os workers passarem a um papel de login próprio, esse papel recebe
  `GRANT hm_outbox_relay TO <papel>`. **Nunca** o papel de login da API: hoje `hm_app_login` é
  compartilhado, e conceder a ele abriria a leitura para a API.

### Garantia e dedup

- A entrega é **pelo menos uma vez**. Duplicata só acontece em falha: o relay publicou e caiu
  antes do COMMIT, ou a confirmação passou do prazo e o broker tinha aceitado.
- Onde a duplicata é absorvida:
  - `outbox.event_id` é único. Gravar o mesmo evento de novo vira `DO NOTHING` e não aborta a
    transação de negócio.
  - O fan-out de webhooks deduplica pelo índice único `(webhook_id, payload #>> '{_meta,eventId}')`.
  - O outbound deduplica pela guarda `external_id` (F52-S04).
  - O envelope é gravado pronto, então o `envelope.id` é o mesmo em toda republicação.

### Relay (`apps/workers/src/outbox`)

- **Lote:** `FOR UPDATE SKIP LOCKED` em ordem de `id` numa transação curta, com
  `idle_in_transaction_session_timeout` 30s e `lock_timeout` 5s.
- **Publicação:** canal com publisher confirms e `mandatory: true`. Mensagem sem rota volta como
  `basic.return` e conta como falha. O prazo de confirmação é 10s; estourado, o canal é
  descartado. Só depois do ack a linha vira `sent`.
- **Broker fora** (não conecta, conexão caiu): nenhuma linha é reivindicada, e o relay reconecta
  com backoff de 500ms até o teto de 30s. Uma queda longa não gasta tentativa de mensagem.
- **Mensagem recusada** (nack, sem rota, confirmação fora do prazo): a linha ganha uma tentativa e
  volta com backoff de 1s·2^(n-1), teto de 5min, jitter de 50–100%. Na 12ª tentativa vira `dead`,
  com log de erro. Envelope corrompido vai direto para `dead`.
- **Acordar:** `LISTEN hm_outbox`, alimentado por um trigger de statement que dispara `pg_notify`
  e é entregue só no COMMIT. Há polling de segurança de 1s. Se o LISTEN não subir no boot, o relay
  tenta de novo a cada minuto.
- **Limpeza:** a cada 10min.
  - `sent` com mais de 7 dias sai pelo índice parcial `idx_outbox_sent_at`.
  - `dead` com mais de 30 dias sai pelo índice parcial `idx_outbox_dead`.
  - Os DELETEs são em lotes de 5000, com `SKIP LOCKED`.
  - O log traz o backlog (pendentes, vencidos, mortos, idade da mais antiga) e dá `error` enquanto
    houver mortos.
- **Configuração:** env opcional `OUTBOX_BATCH_SIZE`, `OUTBOX_POLL_MS`, `OUTBOX_MAX_ATTEMPTS`,
  `OUTBOX_SENT_RETENTION_DAYS` e `OUTBOX_DEAD_RETENTION_DAYS`.
- **Processos:** uma instância por processo de workers, e o `SKIP LOCKED` reparte as linhas. O
  relay para por último entre os produtores no shutdown.

### Produtores migrados

- **Na transação do dado:**
  - lead ads: `conversation.opened`, `message.received`, `deal.created`;
  - eco do app e histórico da coexistência: `conversation.opened`;
  - inbound: `conversation.opened`, `message.received`;
  - disparo de campanha: `conversation.opened` e o job de outbound;
  - followup de campanha: o job, que antes era publicado DENTRO da transação;
  - automação: `conversion.registered`.
- **A compensação pós-commit da F70-S14 saiu.** O teste de rollback continua e agora afirma nada
  na outbox. Outro teste afirma um job por delivery.
- **`message.sent` (outbound/finalize):** o status é gravado por uma porta em
  `outbound/db-ports.ts`, fora desta fronteira, então o evento entra numa transação própria logo
  depois. Se essa gravação falhar, o erro sobe e o job volta pela fila. A guarda `alreadySent`
  não reenvia ao provider, e o finalize roda de novo com o mesmo eventId. Para ficar atômico, a
  porta de persistência precisa aceitar os eventos (sub-slot).
- **Contrato inválido:** evento que viola o contrato é logado e descartado, sem derrubar a
  mutação. É a mesma semântica do `emitDomainEvent`.

### Como reverter a 0086

```sql
DROP TABLE IF EXISTS outbox;
DROP FUNCTION IF EXISTS public.outbox_notify();
DROP INDEX IF EXISTS uq_outbound_webhook_deliveries_event;
DROP ROLE IF EXISTS hm_outbox_relay;  -- depois de revogar as filiações
```

Se o pré-voo da 0086 acusar duplicatas em `outbound_webhook_deliveries`, a limpeza é decisão
humana. O critério sugerido é manter a entrega mais antiga de cada par `(webhook_id, eventId)`,
preferindo a `sent`.

## Validação

```bash
python scripts/slot.py check-migrations
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/outbox/relay.test.ts src/webhooks/fanout-dedup.test.ts --maxWorkers=2
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/leadgen/db-store.test.ts src/coexistence/conversation-opened.test.ts src/campaigns/conversation-opened.test.ts src/coexistence/coexistence.test.ts --maxWorkers=2
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/mq/outbox.test.ts src/mq/domain-events.test.ts --maxWorkers=2
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/db typecheck
pnpm --filter @hm/workers typecheck
```

## Resumo

- **Tabela `outbox` (0086):**
  - colunas: `id` identity, `event_id` único, `kind event|job`, `workspace_id` (FK com cascade),
    `exchange '' | hm.events`, `routing_key`, `envelope` jsonb pronto, `status pending|sent|dead`,
    `attempts`, `available_at`, `last_error`, `sent_at`;
  - índices parciais de pendentes, enviados e mortos;
  - trigger de NOTIFY; privilégios e RLS descritos em Decisões.
- **API de gravação:**
  - `enqueueOutbox(tx, msgs)` e `enqueueOutboxStandalone(msgs)` em `@hm/db`;
  - construtores em `@hm/shared/mq`: `domainEventsOutbox(drafts)` (descarta e loga contrato
    violado) e `queueJobOutbox(QUEUES.outbound, envelope)`.
- **Relay:** `OutboxRelay` em `apps/workers/src/outbox`, ligado no bootstrap. Usa SKIP LOCKED,
  confirms com `mandatory`, backoff e `dead`, LISTEN/NOTIFY com polling e limpeza. O publisher de
  confirmação fica em `@hm/shared/mq/confirm`.
- **Fan-out:** um único `INSERT … SELECT unnest(webhooks) … ON CONFLICT DO NOTHING` sobre o índice
  único. O advisory lock e a varredura por webhook saíram.
- **Testes (dev real):**
  - relay: 10;
  - dedup do fan-out: 4;
  - produtores: 17 (leadgen 8, coexistência 5, campanha 4);
  - coexistência (fake db): 44;
  - construtores: 5.
- **Para a F70-S17:**
  - trocar `emitDomainEvent` (depois do commit) por
    `enqueueOutbox(tx, domainEventsOutbox([...]))` dentro da transação `withWorkspace`;
  - não precisa de grant novo;
  - o teste lê a outbox pelo `workspace_id`, como `apps/workers/src/outbox/testing.ts`.
- **Pendências:**
  - `message.sent` atômico com o status (porta em `outbound/db-ports.ts`);
  - métricas Prometheus da outbox (`observability/`: backlog, idade da mais antiga, mortos),
    hoje só em log;
  - jobs de mídia da coexistência seguem publicados depois do commit, sem garantia (best-effort,
    como antes).
