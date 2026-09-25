---
id: F70-S27
title: Falha de storage visível e mídia reprocessável depois de corrigida
phase: F70
status: done
priority: critical
estimated_size: M
depends_on: [F70-S25]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S21-ultimos-publicadores-pos-commit.md
agent_id: backend-engineer
claimed_at: 2026-09-25T14:41:44Z
completed_at: 2026-09-25T19:41:20Z

---
# F70-S27 — Falha de storage visível e mídia reprocessável depois de corrigida

## Objetivo

Quando o storage de objetos falhar, o operador saber na hora (log, health, alerta), a tela dizer que a mídia falhou em vez de ficar "carregando" para sempre, e, depois de corrigida a causa, as mídias perdidas serem reprocessadas com um comando.

## Contexto (incidente de 25/09, produção)

- O chat mostra "carregando mídia…" / "carregando áudio…" sem fim.
- Os jobs de `hm.q.media` falham com `x-hm-error: AccessDenied: Access Denied`: 6 em `hm.q.media.retry.600000` e 2 na `hm.q.dlq`.
- Causa: a credencial do R2 (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, bucket `leadium-production`, que existe) é recusada até para leitura: `HeadBucket` 403 e `ListObjectsV2` `AccessDenied`. Token revogado, expirado ou com escopo errado. A correção da credencial é operacional (token novo no painel da Cloudflare).
- O que falhou no sistema:
  - nenhum log `warn`/`error` do worker de mídia sobre o erro de storage;
  - o health não acusou o storage negado (`fix/health-storage-probe` tornou a sonda não bloqueante, mas nada alerta);
  - a UI não tem estado de falha;
  - não há reprocessamento depois da correção;
  - o envelope do job de mídia do inbound saía com `workspaceId` zerado (corrigido na F70-S21).
- "De novo": é a segunda vez que a mídia para por storage (ver F61-S11 "mídia honesta").

## Escopo

### files_allowed

- `apps/workers/src/media/**`
- `packages/storage/src/**`
- `apps/api/src/routes/health*.ts`
- `apps/api/src/routes/health/**`
- `apps/api/src/routes/media/**`
- `apps/api/src/routes/conversations/messages.ts`
- `apps/web/features/conversations/components/MessageBubble/**`
- `infra/docker/prometheus/**`
- `infra/docker/alertmanager/**`
- `scripts/reprocess-media.*`
- `docs/runbooks/**`
- `apps/api/src/health.ts`, `apps/api/src/health.test.ts` *(correção 2026-09-25: a sonda de storage mora aqui, não em `routes/health*`, que não existe)*
- `apps/api/src/routes/conversations/messages.retry-media.test.ts` *(correção: teste da rota `retry-media` que entrou em `messages.ts`)*
- `infra/prometheus/alerts.yml`, `infra/prometheus/alerts.storage.test.yml` *(correção: Prometheus e Alertmanager moram em `infra/prometheus/`; `infra/docker/prometheus` e `infra/docker/alertmanager` não existem. O `alertmanager.yml` não mudou: o roteamento por `severity` já cobre as regras novas)*

*(Antes de editar fora da lista, nota de correção no slot, no padrão da F69-S03.)*

## Escopo (faz)

- **Worker:** erro de storage (ou qualquer falha que não seja de download) loga `warn` por tentativa e `error` na tentativa final, com código, operação (put/head), bucket e o id da mensagem. Sem credencial nem URL assinada no log. Classificar: `AccessDenied`/`InvalidAccessKeyId`/`SignatureDoesNotMatch` são **falha de configuração**. Não gastam as retentativas do job: o job volta com backoff longo e um contador de "storage indisponível" sobe.
- **Health e alerta:** a sonda de storage faz um `HeadBucket` barato com cache e expõe o estado (`storage: ok | denied | unreachable`). A métrica Prometheus e a regra do Alertmanager disparam quando o storage fica negado.
- **Estado da mídia na mensagem:** `pending` → `ready` | `failed` (com motivo curto, sem segredo). A UI troca o "carregando" eterno por "Não foi possível carregar a mídia" depois da falha definitiva ou de um tempo limite, com ação "tentar de novo" para quem tem permissão.
- **Reprocessamento:** script idempotente, com `--dry-run`, que lista as mensagens com mídia não ingerida (por workspace e janela de tempo) e reenfileira pela outbox. Também reprocessa o que estiver na DLQ de mídia. Runbook: "storage recusou → troca a credencial → roda o reprocessamento".

## Definition of Done

- [x] teste: storage `AccessDenied` → log `warn` estruturado, job não esgota as retentativas, contador sobe *(`media/storage-failure.test.ts`: warn com código/operação/bucket/id e sem chave nem URL assinada; o worker republica em `hm.q.media.retry.1800000` com o MESMO `x-hm-retries`, inclusive com a escada esgotada; `storageFailure('config', …)` e `jobParked()` contam)*
- [x] teste: sonda de storage reporta `denied` com credencial inválida *(`packages/storage/src/errors.test.ts`: `R2Driver.probe()` do AWS SDK de verdade contra um S3 falso local que responde `HEAD` 403 → `denied`/`AccessDenied`; `health.test.ts`: `/health` → `storage: denied`, `hm_storage_state{state="denied"} = 1`)*
- [x] teste: mensagem com mídia em falha definitiva vira `failed`, e a UI mostra o estado e o botão *(`media.test.ts`: 404 da Meta → `failed` = `media_expired` na hora; `reprocess.test.ts`: `markFailed` grava `media_status = failed`, o motivo e o job; `mediaFailure.test.tsx`: `failed`/prazo vencido → erro, "Não foi possível carregar…" + motivo + "Tentar de novo" só com permissão; `messages.retry-media.test.ts`: o botão reenfileira)*
- [x] teste: `--dry-run` lista; execução reenfileira uma vez por mensagem (rodar 2x não duplica) *(`reprocess.test.ts`, Postgres dev isolado com a 0091: dry-run não grava nem tira nada da DLQ; a execução grava 3 jobs pelo `inboundMediaJobOutbox`, com o workspace real; a segunda execução dá 0 novos e 3 já a caminho)*
- [x] runbook do incidente *(`docs/runbooks/storage-recusou-midia.md`)*

## Decisões

- **Três naturezas de falha, três reações.** `@hm/storage` classifica e saneia (`StorageError`: código, operação, bucket, status HTTP; nunca a mensagem crua do provedor, que no `InvalidAccessKeyId` ecoa a chave, nem o corpo da resposta).
  - **Configuração** (`AccessDenied`, `InvalidAccessKeyId`, `SignatureDoesNotMatch`, `NoSuchBucket`, 401/403): a mensagem vira `failed` = `storage_unavailable` e o job é **estacionado**.
  - **Transitória** (rede, timeout, 5xx, 429): segue a escada; só a última tentativa marca `failed` (`storage_error`) e loga `error`.
  - **Provedor:** a Meta respondeu 404/410 → `failed` = `media_expired` na hora, sem passar pela fila. Outro erro não retentável → `media_unavailable`.
- **Estacionar, não retentar.** A escada inteira (5s → 30min) cabe em ~40min; trocar um token leva horas. O worker republica o job na wait-queue de 30min (já declarada pelo `assertTopology`, nenhuma topologia nova) com o MESMO `x-hm-retries` e um `x-hm-storage-parks` de diagnóstico.
  - Teto de 7 dias estacionado. Depois disso o job vai para a DLQ com motivo, e o script o recupera.
  - Para ler a tentativa corrente, o worker de mídia passou a consumir com `channel.consume` próprio, reusando `handleConsumeFailure` (mesma política da fila). A fachada resiliente de `connectMq` re-registra o consumer na reconexão.
- **Sem migração.** O motivo fica em `metadata.mediaFailure = { reason, code?, at }` e o job em `metadata.mediaJob`, ambos gravados pelo worker na falha. `media_status` já tinha `failed` (F52-S01). O sucesso limpa os dois. `markFailed` nunca rebaixa mídia já ingerida.
- **Sonda `HeadBucket`, não `PUT`.** Barata e não deixa objeto no bucket. Estados: `ok | denied | unreachable` (+ `checking` antes da primeira medição). Métrica `hm_storage_state{state}`.
  - Limite: um token só de leitura passa no `HeadBucket`. Por isso o segundo alerta (`LeadiumMediaStorageDenied`) usa as recusas REAIS de upload do worker (`hm_media_storage_failures_total{kind="config"}`).
- **"Tentar de novo".** `POST /api/conversations/:id/messages/:messageId/retry-media` reenfileira pela outbox, na mesma transação que volta a mídia para `pending`.
  - Permissão `conversation.assign`, a mesma de responder.
  - Linha travada com `FOR UPDATE`. Um pedido em voo depois da última falha segura novos cliques por 10min.
  - Motivo terminal → 409. Sem job guardado → 409 `no_reference`: essa mensagem só o script recupera, porque o `hm_app` não lê a outbox.
  - A bolha desiste de "carregando" em 2min. Mídia expirada aparece como indisponível, sem botão.
- **Script em TypeScript com `tsx`** (`scripts/reprocess-media.ts` → `apps/workers/src/media/reprocess.ts`). Motivo: reusa exatamente os contratos do worker (schema do job, `inboundMediaJobOutbox` com o workspace real que a 0091 exige, `withWorkspace` com RLS, formato da DLQ). O `tsx` é o runtime da imagem dos workers.
  - **Fonte do job, em ordem:** `metadata.mediaJob`, o último job de mídia ainda na outbox (retenção de 7 dias) e a DLQ.
  - **Idempotência:** trava a linha, confere o pedido em voo e grava `metadata.mediaReprocess` na mesma transação do job. Não depende do `event_id` (a unicidade virou `(workspace_id, event_id)` na F70-S24).
  - **Janelas de recuperação do provedor:** estimativas conservadoras (WhatsApp 30d, Instagram e WAHA 7d), ajustáveis por `--max-age-days`.

## Validação

```bash
pnpm --filter @hm/storage typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/web typecheck
node packages/storage/node_modules/vitest/vitest.mjs run --root packages/storage --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/media --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/health.test.ts src/routes/conversations/messages.retry-media.test.ts src/routes/conversations/messages.test.ts src/routes/conversations/messages.outbox.integration.test.ts --maxWorkers=1
node apps/web/node_modules/vitest/vitest.mjs run --root apps/web features/conversations/components/MessageBubble features/conversations/hooks/messageCache.test.ts --maxWorkers=1
```

Fora do bloco (Docker): `promtool check rules` → 11 regras OK; `promtool test rules infra/prometheus/alerts.storage.test.yml` → SUCCESS. Os testes de banco rodaram num Postgres dev isolado (`highermind_f70s27`, migrações até a 0091, que ainda não está no banco compartilhado).
