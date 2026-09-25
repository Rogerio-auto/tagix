---
id: F70-S27
title: Falha de storage visível e mídia reprocessável depois de corrigida
phase: F70
status: available
priority: critical
estimated_size: M
depends_on: [F70-S25]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S21-ultimos-publicadores-pos-commit.md
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

*(Antes de editar fora da lista, nota de correção no slot, no padrão da F69-S03.)*

## Escopo (faz)

- **Worker:** erro de storage (ou qualquer falha que não seja de download) loga `warn` por tentativa e `error` na tentativa final, com código, operação (put/head), bucket e o id da mensagem. Sem credencial nem URL assinada no log. Classificar: `AccessDenied`/`InvalidAccessKeyId`/`SignatureDoesNotMatch` são **falha de configuração**. Não gastam as retentativas do job: o job volta com backoff longo e um contador de "storage indisponível" sobe.
- **Health e alerta:** a sonda de storage faz um `HeadBucket` barato com cache e expõe o estado (`storage: ok | denied | unreachable`). A métrica Prometheus e a regra do Alertmanager disparam quando o storage fica negado.
- **Estado da mídia na mensagem:** `pending` → `ready` | `failed` (com motivo curto, sem segredo). A UI troca o "carregando" eterno por "Não foi possível carregar a mídia" depois da falha definitiva ou de um tempo limite, com ação "tentar de novo" para quem tem permissão.
- **Reprocessamento:** script idempotente, com `--dry-run`, que lista as mensagens com mídia não ingerida (por workspace e janela de tempo) e reenfileira pela outbox. Também reprocessa o que estiver na DLQ de mídia. Runbook: "storage recusou → troca a credencial → roda o reprocessamento".

## Definition of Done

- [ ] teste: storage `AccessDenied` → log `warn` estruturado, job não esgota as retentativas, contador sobe
- [ ] teste: sonda de storage reporta `denied` com credencial inválida
- [ ] teste: mensagem com mídia em falha definitiva vira `failed`, e a UI mostra o estado e o botão
- [ ] teste: `--dry-run` lista; execução reenfileira uma vez por mensagem (rodar 2x não duplica)
- [ ] runbook do incidente
