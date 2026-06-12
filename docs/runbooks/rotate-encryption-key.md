# Runbook — Rotação da chave de criptografia de secrets (`*_enc`)

> **Para quem:** SRE / on-call do `tagix` (Highermind v2) rotacionando a chave AES-256-GCM que cifra secrets em DB, em produção, sem downtime.
> **Por quê:** suspeita de vazamento da `ENCRYPTION_KEY`, rotação periódica de compliance, ou troca de operador.
> **Ambiente:** VPS Ubuntu, Docker Compose. Cifra implementada em `packages/db/src/crypto.ts` (`encryptSecret`/`decryptSecret`, AES-256-GCM, formato `base64(iv):base64(tag):base64(ciphertext)`).
> **Comandos são bash (Linux/prod). Nunca PowerShell.**

> ⚠️ **A chave protege dados que NÃO podem ser perdidos.** Se você remover a chave antiga antes de re-cifrar 100% dos secrets, eles ficam **irrecuperáveis**. Este runbook só remove a chave antiga depois de provar migração completa (§6). Faça backup do banco (§2) antes de começar.

---

## 0. O que está cifrado com esta chave

Colunas `*_enc` cifradas com `ENCRYPTION_KEY` via `encryptSecret`:

| Tabela | Coluna(s) | Conteúdo |
|---|---|---|
| `channel_secrets` | `access_token_enc`, `refresh_token_enc`, `app_secret_enc`, `api_key_enc` | tokens dos canais (Meta WA/IG, WAHA). Tem coluna `key_version`. |
| `outbound_webhooks` | `secret_enc` | segredo HMAC das assinaturas de webhook |
| `platform_secrets` | `value_enc` | secrets de plataforma (openrouter_api_key, meta_app_secret, etc.) |

> **Nota de implementação — leia antes de agir.** O `getKey()` atual em `packages/db/src/crypto.ts` resolve **uma única** `ENCRYPTION_KEY` (o parâmetro `keyVersion` existe mas é ignorado no MVP), e o payload **não** carrega prefixo de versão (`vN:`). Portanto a rotação aqui é **re-cifrar todos os secrets com a chave nova e trocar a env** — não há suporte runtime a duas chaves simultâneas no código atual. A coluna `channel_secrets.key_version` é o ledger de qual chave cifrou cada linha; use-a para rastrear progresso.
>
> Se/quando o código passar a suportar multi-versão (`ENCRYPTION_KEY_V1`/`V2` como em `INFRASTRUCTURE.md` §10.2), prefira o caminho zero-downtime nativo. Até lá, siga **um** dos modos abaixo.

---

## 1. Pré-requisitos

```bash
cd /root/highermind
export COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
set -a; source /root/highermind/.env; set +a
psqlc() { $COMPOSE exec -T postgres psql -U "$PG_USER" -d highermind "$@"; }

# Gere a chave NOVA (32 bytes hex = 64 chars). Guarde no cofre antes de usar.
NEW_KEY="$(openssl rand -hex 32)"
echo "Comprimento: ${#NEW_KEY} (deve ser 64)"
# Guarde a ANTIGA para rollback:
OLD_KEY="$ENCRYPTION_KEY"
```

---

## 2. ⚠️ OBRIGATÓRIO — backup antes de re-cifrar

```bash
$COMPOSE exec -T postgres pg_dump --format=custom --compress=9 -U "$PG_USER" highermind \
  > "/root/pre-keyrotate-$(date +%Y%m%d-%H%M%S).pgcustom"
```

Confirme tamanho > 0. Este dump (cifrado com a chave **antiga**, ainda íntegro) é o rollback definitivo.

---

## 2.5 Inventário (saiba quanto há a migrar)

```bash
psqlc -c "
  select 'channel_secrets' t, count(*) c from channel_secrets
  union all select 'outbound_webhooks', count(*) from outbound_webhooks
  union all select 'platform_secrets', count(*) from platform_secrets;"
psqlc -c "select key_version, count(*) from channel_secrets group by key_version order by 1;"
```

---

## Modo A — Re-cifrar em lote, depois trocar a chave (MVP, código single-key)

Este é o modo **padrão hoje**. A re-cifra roda com a chave antiga ainda ativa (para decifrar) e grava com a nova; só ao final você troca a env e reinicia.

### A.1 Re-encrypt em lote (idempotente, em transação)

Rode um script Node dentro do container `api` (tem `@hm/db` e ambas as chaves no env). O script decifra com `OLD_KEY` e re-cifra com `NEW_KEY`, em batches, dentro de transação:

```bash
$COMPOSE exec -T \
  -e OLD_ENCRYPTION_KEY="$OLD_KEY" \
  -e NEW_ENCRYPTION_KEY="$NEW_KEY" \
  api node -e '
const { Client } = require("pg");
const crypto = require("crypto");
const ALGO = "aes-256-gcm", IV = 12;
const oldKey = Buffer.from(process.env.OLD_ENCRYPTION_KEY, "hex");
const newKey = Buffer.from(process.env.NEW_ENCRYPTION_KEY, "hex");
function dec(p, k){ const [iv,t,c]=p.split(":"); const d=crypto.createDecipheriv(ALGO,k,Buffer.from(iv,"base64")); d.setAuthTag(Buffer.from(t,"base64")); return Buffer.concat([d.update(Buffer.from(c,"base64")),d.final()]).toString("utf8"); }
function enc(s, k){ const iv=crypto.randomBytes(IV); const c=crypto.createCipheriv(ALGO,k,iv); const e=Buffer.concat([c.update(s,"utf8"),c.final()]); return `${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${e.toString("base64")}`; }
const rekey = (v)=> v==null ? null : enc(dec(v, oldKey), newKey);
(async ()=>{
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("begin");
    // channel_secrets
    const cs = await db.query("select channel_id, access_token_enc, refresh_token_enc, app_secret_enc, api_key_enc from channel_secrets for update");
    for (const r of cs.rows) {
      await db.query(
        "update channel_secrets set access_token_enc=$1, refresh_token_enc=$2, app_secret_enc=$3, api_key_enc=$4, key_version=key_version+1, updated_at=now() where channel_id=$5",
        [rekey(r.access_token_enc), rekey(r.refresh_token_enc), rekey(r.app_secret_enc), rekey(r.api_key_enc), r.channel_id]);
    }
    // outbound_webhooks
    const wh = await db.query("select id, secret_enc from outbound_webhooks for update");
    for (const r of wh.rows) await db.query("update outbound_webhooks set secret_enc=$1 where id=$2", [rekey(r.secret_enc), r.id]);
    // platform_secrets
    const ps = await db.query("select id, value_enc from platform_secrets for update");
    for (const r of ps.rows) await db.query("update platform_secrets set value_enc=$1 where id=$2", [rekey(r.value_enc), r.id]);
    await db.query("commit");
    console.log(`re-encrypted: channel_secrets=${cs.rowCount} webhooks=${wh.rowCount} platform_secrets=${ps.rowCount}`);
  } catch (e) { await db.query("rollback"); console.error("ROLLED BACK:", e.message); process.exit(1); }
  finally { await db.end(); }
})();'
```

Se falhar no meio, o `rollback` garante atomicidade — nada fica meio-cifrado. Corrija a causa e re-rode (idempotência: rodar de novo só re-cifra com a mesma `NEW_KEY`, sem corromper).

### A.2 Trocar a env para a chave nova e reiniciar

A coluna `*_enc` agora está cifrada com `NEW_KEY`, mas os containers ainda têm `OLD_KEY` em memória. Troque e reinicie em rolling:

```bash
# Atualize o .env (faça backup do arquivo antes):
cp /root/highermind/.env /root/highermind/.env.bak-$(date +%s)
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${NEW_KEY}|" /root/highermind/.env
grep '^ENCRYPTION_KEY=' /root/highermind/.env | sed -E 's|=.{8}.*|=<redacted>|'

# Rolling restart dos serviços que decifram secrets (sem derrubar tudo de uma vez):
for svc in api worker-outbound worker-inbound worker-media worker-flows worker-campaigns scheduler; do
  $COMPOSE up -d --no-deps --force-recreate "$svc"
  sleep 5
done
# agent-runtime recebe secrets via env no boot — recrie também:
$COMPOSE up -d --no-deps --force-recreate agent-runtime
```

Vá para §6 (verificação).

---

## Modo B — Zero-downtime nativo (quando o código suportar multi-versão)

Use só se `getKey()` já resolver `ENCRYPTION_KEY_V{n}` e o payload carregar prefixo `vN:`.

1. Adicione a chave nova **sem remover a antiga**, e mantenha a antiga como versão decifrável:

   ```bash
   echo "ENCRYPTION_KEY_V2=${NEW_KEY}" >> /root/highermind/.env
   sed -i "s|^CURRENT_ENCRYPTION_KEY_VERSION=.*|CURRENT_ENCRYPTION_KEY_VERSION=2|" /root/highermind/.env
   ```

2. Rolling restart (igual A.2). Agora **escritas novas** usam v2; **leituras** de v1 e v2 funcionam (ambas as chaves presentes). Já não há downtime nem janela de inconsistência.

3. Dispare a re-cifra em lote do v1 → v2 (mesma lógica do A.1, gravando prefixo `v2:`), ou deixe o cron `rotate_secrets` (`INFRASTRUCTURE.md` §10.2) drenar.

4. Vá para §6. **Só remova `ENCRYPTION_KEY_V1` do env após §6 provar 0 secrets em v1.**

---

## 6. Verificação ("resolvido")

1. Nenhum serviço quebrou ao decifrar (ausência de erros de auth da cifra):

   ```bash
   $COMPOSE logs --tail=100 api worker-outbound \
     | grep -i -E 'unable to authenticate data|decrypt|Unsupported state' || echo "sem erros de decrypt"
   ```

2. Prova funcional ponta-a-ponta — um secret real decifra com a chave NOVA já ativa nos containers:

   ```bash
   # Pega um access_token_enc e testa decrypt dentro do api (sem imprimir o plaintext):
   ENC="$(psqlc -tA -c 'select access_token_enc from channel_secrets limit 1;')"
   $COMPOSE exec -T -e SAMPLE_ENC="$ENC" api node -e '
     const { decryptSecret } = require("@hm/db");
     decryptSecret(process.env.SAMPLE_ENC); console.log("decrypt OK com chave ativa");'
   ```

3. Ledger de versão avançou (Modo A) — toda linha re-cifrada teve `key_version` incrementado:

   ```bash
   psqlc -c "select key_version, count(*) from channel_secrets group by key_version order by 1;"
   ```

4. Smoke de canal: envie/receba uma mensagem de teste num canal real (o envio usa o `access_token` decifrado). Se a mensagem sai, a chave nova está servindo os secrets em produção.

5. **(Modo B) Só agora** confirme 0 secrets na versão antiga e remova `ENCRYPTION_KEY_V1`:

   ```bash
   # Garanta que nenhum payload começa com "v1:" antes de remover a chave v1.
   sed -i '/^ENCRYPTION_KEY_V1=/d' /root/highermind/.env
   ```

**Resolvido quando:** §6.1 sem erros + §6.2 decrypt OK + §6.4 mensagem de teste passa.

---

## 7. Rollback

Se um secret deixou de decifrar (canal caiu, webhook parou de assinar) após a troca:

1. **Reverta a env para a chave antiga** (a forma mais rápida, se a re-cifra A.1 NÃO completou ou foi parcial):

   ```bash
   cp /root/highermind/.env /root/highermind/.env.failed-$(date +%s)
   sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${OLD_KEY}|" /root/highermind/.env
   for svc in api worker-outbound worker-inbound worker-media worker-flows worker-campaigns scheduler agent-runtime; do
     $COMPOSE up -d --no-deps --force-recreate "$svc"; sleep 5
   done
   ```

   > Isto **só funciona se os dados em DB ainda estiverem cifrados com a chave antiga**. Se a re-cifra A.1 já committou (dados em `NEW_KEY`), voltar a env para `OLD_KEY` quebra o decrypt — neste caso use o passo 2.

2. **Restaure o dump pré-rotação** (§2) seguindo [`restore-from-backup.md`](./restore-from-backup.md) §4 Caminho B, e mantenha `ENCRYPTION_KEY=OLD_KEY`. Isso devolve dados + chave consistentes.

3. Investigue a causa (chave mal copiada, env não propagado a um serviço) antes de tentar de novo.

---

## 8. Pós-incidente

- Destrua a chave antiga do cofre **somente** após §6 estável por 24h e backups novos (cifrados com a chave nova) confirmados.
- Registre data da rotação e motivo. Se foi vazamento, trate como incidente de segurança (auditar acesso, revisar quem tinha a chave).
- Considere abrir follow-up para implementar o suporte multi-versão nativo (Modo B), tornando futuras rotações verdadeiramente zero-downtime.
