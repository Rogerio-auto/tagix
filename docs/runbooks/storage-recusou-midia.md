# Runbook — Storage recusou a credencial: mídia parada (produção)

> **Para quem:** on-call da Leadium quando a mídia recebida para de carregar ("carregando áudio…", "Não foi possível carregar a mídia") ou quando toca `LeadiumStorageDenied` / `LeadiumMediaStorageDenied`.
> **Ambiente:** VPS Ubuntu, Docker Swarm (stack `leadium`), storage Cloudflare R2 (bucket `leadium-production`). Comandos em bash (prod).
> **Severidade:** SEV2. Texto e agentes seguem funcionando; mídia recebida não é guardada e links de mídia antigos não abrem.
> **Histórico:** 2026-09-09 (F61-S11) e 2026-09-25 (F70-S27). Nas duas vezes o token do R2 foi recusado.

Resumo: **o storage recusou → troque a credencial → confira a sonda → rode o reprocessamento.** Nada se perde enquanto isso: desde a F70-S27 os jobs de mídia ficam estacionados, sem gastar retentativa, até a credencial voltar a funcionar (limite de 7 dias).

---

## 1. Confirmar o diagnóstico (2 minutos)

```bash
cd /opt/leadium
export STACK=leadium
API_CID() { docker ps -qf "name=${STACK}_api" | head -1; }
WORKERS_CID() { docker ps -qf "name=${STACK}_workers" | head -1; }

# a) O /health diz o estado do storage (sondagem HeadBucket a cada 60s)
docker exec "$(API_CID)" node -e "fetch('http://localhost:3001/health').then(r=>r.json()).then(j=>console.log(j.storage, j.status))"
#   ok          → o storage aceita a credencial (vá para o §4 se ainda há mídia parada)
#   denied      → o storage RECUSA a credencial: é este runbook (§2)
#   unreachable → o storage não responde: rede/Cloudflare, não credencial (§5)
#   checking    → container recém-subido; repita em 1 minuto

# b) O log do worker de mídia diz o que foi recusado (sem segredo: código, operação, bucket, id)
docker service logs --since 30m "${STACK}_workers" 2>&1 | grep -E '"media: (storage|job estacionado)' | tail -5
#   storageCode=AccessDenied | InvalidAccessKeyId | SignatureDoesNotMatch → credencial
#   storageCode=NoSuchBucket                                              → nome do bucket
```

| O que aparece | Causa | Ação |
|---|---|---|
| `denied` + `AccessDenied` | token revogado, expirado ou sem escopo no bucket | §2 |
| `denied` + `InvalidAccessKeyId` / `SignatureDoesNotMatch` | par `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` errado ou trocado | §2 |
| `denied` + `NoSuchBucket` | `R2_BUCKET` errado (ou bucket apagado) | corrigir `R2_BUCKET` e seguir do §3 |
| `/health` `ok`, mas `LeadiumMediaStorageDenied` tocando | token **só de leitura**: passa no HeadBucket, falha no PUT | §2, com permissão de escrita |

**Caso de 25/09:** o bucket `leadium-production` existia e o `R2_BUCKET` conferia. Com a credencial atual, até a leitura era recusada (`HeadBucket` 403, `ListObjectsV2` `AccessDenied`). A causa era o token, não o bucket.

## 2. Trocar a credencial

1. Painel da Cloudflare → **R2** → **Manage R2 API Tokens** → **Create API token**.
   - Permissão: **Object Read & Write**.
   - Escopo: **apenas** o bucket `leadium-production`.
   - TTL: sem expiração, ou anote a data de expiração no calendário do time. Token que vence em silêncio foi a causa provável dos dois incidentes.
2. Copie o **Access Key ID** e o **Secret Access Key**. A Cloudflare mostra o secret uma única vez.
3. Na VPS, edite o `.env` (nunca vai para o git):

```bash
sudo nano /opt/leadium/.env   # R2_ACCESS_KEY_ID=…  R2_SECRET_ACCESS_KEY=…
```

4. Aplique o novo `.env` com o deploy idempotente. Ele recria api e workers com as variáveis novas:

```bash
sudo bash /opt/leadium/scripts/deploy.sh main
```

5. Só depois de confirmar o §3: revogue o token antigo no painel, se ele ainda existir.

> Nunca cole o secret em chat, ticket ou log. Para testar a credencial à mão, use a sonda (§3), não um `curl` com a chave na linha de comando: ela fica no histórico do shell.

## 3. Conferir que voltou

```bash
# a) Sonda: deve dizer "ok" em até 60s depois do deploy
docker exec "$(API_CID)" node -e "fetch('http://localhost:3001/health').then(r=>r.json()).then(j=>console.log(j.storage, j.status))"

# b) O log registra a transição (uma linha, só na mudança de estado)
docker service logs --since 10m "${STACK}_api" 2>&1 | grep 'storage acessível' | tail -1

# c) Métrica: hm_storage_state{state="ok"} = 1
docker exec "$(API_CID)" node -e "fetch('http://localhost:3001/metrics').then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>l.startsWith('hm_storage_state')).join('\n')))"
```

Os jobs estacionados voltam sozinhos em até 30 minutos, que é o degrau de espera (`hm.q.media.retry.1800000`). Para não esperar, siga o §4.

## 4. Reprocessar o que ficou para trás

O script reenfileira pela outbox as mensagens com mídia não guardada e também o que morreu na DLQ de mídia. É idempotente: rodar duas vezes não duplica. Mídia velha demais para o provedor ainda devolver o arquivo é **contada, não tentada** (WhatsApp ~30 dias, Instagram/WAHA ~7 dias; estimativas conservadoras).

```bash
# Sempre primeiro o dry-run: lista o que faria, não grava nada, devolve a DLQ intacta.
# --since = um pouco antes do início do incidente (o alerta diz quando começou).
docker exec -w /app/apps/workers "$(WORKERS_CID)" \
  node_modules/.bin/tsx ../../scripts/reprocess-media.ts --since 2026-09-24 --dry-run

# Conferiu a lista e os números? Execute (sem --dry-run):
docker exec -w /app/apps/workers "$(WORKERS_CID)" \
  node_modules/.bin/tsx ../../scripts/reprocess-media.ts --since 2026-09-24
```

Opções úteis: `--workspace <uuid>` (um cliente só, recomendado para começar), `--until <data>`, `--skip-dlq`, `--json` (relatório completo), `--force` (reenfileira mesmo com um pedido anterior em voo, para job perdido), `--help`.

Como ler o resumo:

| Linha | Significado |
|---|---|
| `reenfileiradas` | voltaram para a fila e vão ser baixadas agora |
| `já a caminho` | já havia um reprocessamento pedido depois da última falha, pulado para não duplicar |
| `velhas demais p/ recuperar` | o provedor já apagou o arquivo; não há o que fazer |
| `expiradas/indisponíveis no provedor` | a Meta respondeu que a mídia não existe mais |
| `sem referência do arquivo` | não sobrou o id do arquivo (nem na mensagem, nem na outbox, nem na DLQ) |
| `DLQ: … removidas / devolvidas` | jobs mortos de mídia reenfileirados (removidos) e o resto, que voltou intacto |

Acompanhe: `docker service logs -f "${STACK}_workers" 2>&1 | grep '"media: ingerida'`. O chat troca o erro pela mídia sozinho (`message:media_ready`).

## 5. Storage `unreachable` (não é credencial)

É rede ou o provedor, e não se resolve trocando token.

- Confira o status da Cloudflare R2.
- Teste a saída de rede do container: `docker exec "$(WORKERS_CID)" node -e "fetch('https://cloudflare.com').then(r=>console.log(r.status))"`.

Falhas transitórias sobem a escada normal de retry (5s → 30min). Esgotadas as tentativas, a mensagem fica `failed` e o job vai para a DLQ. Quando o storage voltar, rode o §4.

## 6. O que o sistema faz sozinho (para não brigar com ele)

- **Worker de mídia** (`apps/workers/src/media`): recusa de configuração gera `warn` por tentativa, sobe `hm_media_storage_failures_total{kind="config"}`, marca a mensagem `failed` com motivo `storage_unavailable` e **estaciona** o job por 30 minutos sem gastar retentativa. Depois de 7 dias estacionado, o job vai para a DLQ. Falha transitória segue a escada normal; na última tentativa, o log é `error`.
- **Tela:** a bolha mostra "Não foi possível carregar a mídia" com o motivo em linguagem simples. "Tentar de novo" aparece para quem pode responder a conversa (`POST …/retry-media`, reenfileira pela outbox). Mídia expirada na origem aparece como indisponível, sem botão.
- **Alertas** (`infra/prometheus/alerts.yml`, grupo `leadium-storage`): `LeadiumStorageDenied` e `LeadiumMediaStorageDenied` (page), `LeadiumStorageUnreachable` e `LeadiumMediaFailing` (ticket).

## 7. Depois do incidente

- Registre a data de expiração do token novo, se houver.
- Se o reprocessamento deixou `sem referência` ou `velhas demais`, anote os números no relato do incidente. É mídia perdida de verdade, e o cliente vê o aviso de indisponível.
