# Runbook — Rotação da API key da OpenRouter (`platform_secrets.openrouter_api_key`)

> **Para quem:** super-admin de plataforma / SRE on-call do `tagix` (Highermind v2) trocando a chave OpenRouter usada por **todos** os agentes de **todos** os workspaces.
> **Por quê:** suspeita de vazamento da key, rotação periódica de compliance, troca de billing/conta OpenRouter, ou key revogada pelo provider.
> **Ambiente:** painel de super-admin (F2.5 → Secrets) **ou**, em emergência, via DB em produção (VPS Ubuntu, Docker Compose). Comandos de produção são **bash**, nunca PowerShell.

> ⚠️ **Blast radius máximo.** A key OpenRouter é **única de plataforma** (`platform_secrets`, sem `workspace_id`): toda chamada de chat dos agentes (router `openrouter`) usa esta mesma key. Uma key errada/rotacionada para um valor inválido **derruba os agentes de todos os tenants** até ser corrigida. Não rotacione sem ter a key nova em mãos e validada.

---

## 0. O que esta key controla

| Onde | O quê |
|---|---|
| `platform_secrets` (`key = 'openrouter_api_key'`, `value_enc`, `key_version`) | a key cifrada (AES-256-GCM, `ENCRYPTION_KEY`). Lida no boot da API e pelo sync de catálogo. |
| `POST /platform/models/sync` (F25-S02) | usa a key para puxar `GET https://openrouter.ai/api/v1/models`. |
| Runtime dos agentes (F2) | toda chamada de chat via OpenRouter autentica com esta key; o custo cai em `llm_usage_logs`. |

> A rotação aqui é da **key individual** dentro de `platform_secrets`. A rotação da **chave-mestra** que cifra todos os `*_enc` é outro runbook: `rotate-encryption-key.md` (F10). São coisas diferentes — não confunda.

---

## 1. Pré-requisitos

- Acesso de **platform admin** (`members.is_platform_admin = true`).
- A **key nova** da OpenRouter já criada no dashboard deles (https://openrouter.ai/keys), com créditos/limites adequados, e **testada** antes (passo 2).
- Janela de baixa atividade preferida (a troca é quase instantânea, mas evita ruído).

### 1.1 Valide a key nova ANTES de aplicar

```bash
# Substitua sk-or-NOVA pela key nova. 200 = válida; 401 = inválida (não rotacione!).
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer sk-or-NOVA" \
  https://openrouter.ai/api/v1/models
```

Só prossiga se retornar `200`.

---

## 2. Rotação pelo painel (caminho recomendado)

1. Acesse **Super-admin → Secrets** (`/platform/secrets`).
2. Localize a linha `openrouter_api_key` (mostra `key_version` e `updated_at`, **nunca** o valor em claro).
3. Clique **Rotacionar**, cole a key nova, **confirme** (a confirmação explícita existe porque o impacto é global).
4. Ao salvar: a API re-cifra o valor (AES-256-GCM), incrementa `key_version`, e grava a rotação em `audit_logs` (`action = 'platform.secret_rotated'`, sem o valor). A resposta confirma a nova `key_version`.

> A API lê os secrets no boot. Se a sua topologia cacheia o valor em memória de processo, **reinicie os processos da API/workers** (passo 4) para garantir que a key nova entre em vigor em todos os nós.

---

## 3. Rotação via DB (emergência — sem painel)

Use só se o painel estiver indisponível. Os secrets são cifrados pela mesma cifra do código (`encryptSecret`); cifre com um script Node que importa `@hm/db`, **não** insira texto em claro.

```bash
cd /root/highermind
export COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
set -a; source /root/highermind/.env; set +a

# Cifra a key nova com a MESMA cifra do app e dá o UPDATE (key_version++).
NEW_OR_KEY="sk-or-NOVA" node --input-type=module <<'NODE'
import { getDb, encryptSecret, schema, closeDb } from '@hm/db';
import { sql } from 'drizzle-orm';
const value = process.env.NEW_OR_KEY;
if (!value) throw new Error('NEW_OR_KEY ausente');
const enc = encryptSecret(value);
await getDb().execute(sql`
  insert into platform_secrets (key, value_enc, key_version, updated_at)
  values ('openrouter_api_key', ${enc}, 1, now())
  on conflict (key) do update
    set value_enc = excluded.value_enc,
        key_version = platform_secrets.key_version + 1,
        updated_at = now()
`);
console.log('openrouter_api_key rotacionada.');
await closeDb();
NODE
```

> Registre a rotação manual em `audit_logs` ou abra um incidente, já que o caminho via DB não passa pela auditoria automática do painel.

---

## 4. Aplicar (reiniciar processos que cacheiam a key)

```bash
export COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
$COMPOSE restart api workers
$COMPOSE ps
```

---

## 5. Verificação (critério de "resolvido")

A rotação está **resolvida** quando TODOS abaixo passam:

1. **Catálogo sincroniza** — no painel, **Modelos → Sync OpenRouter** retorna sucesso (a key nova autenticou o `GET /models`). Ou via curl (§1.1) com a key nova.
2. **Agente responde** — dispare uma mensagem de teste a um agente em um workspace de QA; ele responde normalmente.
3. **Custo registra** — `llm_usage_logs` recebe uma linha nova da chamada de teste:

```bash
psqlc() { $COMPOSE exec -T postgres psql -U "$PG_USER" -d highermind "$@"; }
psqlc -c "select created_at, model, router, cost_usd
          from llm_usage_logs order by created_at desc limit 3;"
```

4. **`key_version` subiu** — confirma que o secret foi reescrito:

```bash
psqlc -c "select key, key_version, updated_at from platform_secrets where key='openrouter_api_key';"
```

5. **Sem erros 401** nos logs da API após a troca:

```bash
$COMPOSE logs --since 10m api | grep -i "401\|openrouter" | tail -20
```

---

## 6. Rollback

Se os agentes pararem de responder após a rotação (key nova inválida/sem crédito):

1. Re-rotacione para a **key antiga** (que você guardou) — mesmo caminho (§2 painel ou §3 DB).
2. Reinicie (`$COMPOSE restart api workers`).
3. Valide com §5.

> A key antiga só deixa de funcionar se você a **revogar no dashboard da OpenRouter**. Não revogue a antiga até a nova estar provada por §5. Mantenha as duas válidas durante a janela de rotação.

---

## 7. Pós-rotação

- Revogue a key **antiga** no dashboard da OpenRouter (depois de §5 verde).
- Confirme que a rotação está em `audit_logs` (painel grava automaticamente; DB manual exige registro manual).
- Atualize o cofre de segredos da equipe com a referência (nunca o valor) da nova `key_version`.
