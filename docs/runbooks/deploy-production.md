# Runbook — Deploy de Produção (Leadium)

Como a Leadium é publicada e atualizada na VPS de produção. **Padrão da casa:
Docker Swarm + Traefik + Portainer.** A Leadium roda 100% isolada da infra que já
existe no servidor (Postgres/n8n/Redis de outros projetos **não são tocados nem
reusados**).

> Memória relacionada: `leadium-vps-deploy-target` (topologia + credenciais).

---

## 1. Arquitetura na VPS

```
                    Internet (HTTPS :443)
                          │
                    ┌─────▼─────┐   Let's Encrypt automático
                    │  Traefik  │   (resolver "letsencrypt")
                    └─────┬─────┘
        ┌─────────────────┼───────────────────────────┐
        │ Host(app.)      │ Host(app.)/{api,auth,      │ Host(api.)   Host(apex)
        │ prio 1          │ socket.io} prio 20         │ prio 10
        ▼                 ▼                            ▼              ▼
   ┌─────────┐       ┌─────────┐                  ┌─────────┐   ┌──────────┐
   │  web    │       │   api   │◄─────────────────┤   api   │   │ landing  │
   │ :3000   │       │  :3001  │  (mesmo serviço) │  :3001  │   │  :80     │
   └────┬────┘       └────┬────┘                  └─────────┘   └──────────┘
        │ network_public  │  network_public + leadium_internal
        └─────────────────┤
                          ▼  leadium_internal (interna, SEM porta no host)
        ┌─────────────┬───────────────┬────────────────┬──────────────┐
        ▼             ▼               ▼                ▼              ▼
   ┌─────────┐  ┌──────────┐   ┌────────────┐   ┌──────────┐   ┌──────────────┐
   │ postgres│  │  redis   │   │  rabbitmq  │   │ workers  │   │ agent-runtime│
   │ pgvector│  │          │   │            │   │ (sem ws) │   │  (IA, :8001) │
   └─────────┘  └──────────┘   └────────────┘   └──────────┘   └──────────────┘
```

**Domínios** (DNS A → `187.77.237.233`):

| Domínio                 | Serviço  | Observação                                            |
|-------------------------|----------|-------------------------------------------------------|
| `app.leadium.com.br`    | web      | App. `/api`, `/auth`, `/socket.io` vão p/ a api (same-origin, cookie ok, WebSocket nativo no Traefik) |
| `api.leadium.com.br`    | api      | API pública v1 + webhooks Meta (auth por token)       |
| `leadium.com.br` (apex) | landing  | Landing page (placeholder até a real entrar)          |

**Isolamento:** Postgres/Redis/RabbitMQ são **próprios** da Leadium, na rede
`leadium_internal` (`internal: true` → sem gateway p/ fora, sem porta publicada).
Zero conflito de porta e zero contato com a infra de terceiros.

---

## 2. Bootstrap (uma vez só)

### 2.1. Acesso SSH por chave
A chave dedicada `~/.ssh/leadium_vps` (Windows do Rogério) já está autorizada no
`root` da VPS. Para recriar:
```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\leadium_vps -N '""' -C "leadium-deploy"
# instalar a pública (uma vez, pede senha):
ssh root@187.77.237.233 "mkdir -p ~/.ssh && echo '<conteudo .pub>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### 2.2. Swap (recomendado — RAM é o gargalo: 8 GB, sem swap)
```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 2.3. Supabase de produção
Criar um **projeto Supabase novo** (separado do de dev). Pegar no painel:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` → vão no `.env`.

### 2.4. Clonar o repositório
O repo é privado (`github.com/Rogerio-auto/tagix`). Use uma **deploy key** (read-only):
```bash
ssh-keygen -t ed25519 -f /root/.ssh/leadium_repo -N "" -C "leadium-vps-deploy-key"
cat /root/.ssh/leadium_repo.pub   # cole em GitHub > repo tagix > Settings > Deploy keys
cat >> /root/.ssh/config <<'EOF'
Host github-leadium
  HostName github.com
  User git
  IdentityFile /root/.ssh/leadium_repo
EOF
git clone git@github-leadium:Rogerio-auto/tagix.git /opt/leadium
```

### 2.5. Preencher o `.env` de produção
```bash
cp /opt/leadium/.env.production.example /opt/leadium/.env
# Gere segredos fortes:
openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 48   # PG_PASSWORD, etc.
nano /opt/leadium/.env
```
Mínimos obrigatórios: `PG_PASSWORD`, `RABBITMQ_PASSWORD`, `SUPABASE_*`,
`ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, `AGENT_RUNTIME_TOKEN`.

### 2.6. Primeiro deploy
```bash
chmod +x /opt/leadium/scripts/deploy.sh
sudo bash /opt/leadium/scripts/deploy.sh main
```
O Traefik emite o certificado SSL automaticamente no primeiro acesso a cada
domínio (HTTP-01 challenge). Aguarde ~30s e acesse `https://app.leadium.com.br`.

**Como o primeiro deploy funciona (F70-S22).** As migrations rodam antes de qualquer código de
app subir, e para isso precisam de um Postgres e da rede interna do stack. Na primeira instalação
nenhum dos dois existe. O `deploy.sh` detecta a ausência do serviço `leadium_postgres` e:

1. recorta do `docker-compose.prod.yml` só o bloco `postgres:` + `networks:` + `volumes:` e faz
   `docker stack deploy` desse recorte, **sem `--prune`**. Nascem o serviço `leadium_postgres`, a
   rede `leadium_leadium_internal` e o volume `leadium_leadium_pgdata`: os mesmos nomes do stack
   completo, então o deploy completo depois reconhece tudo e não reinicia o banco;
2. espera o healthcheck do Postgres ficar `healthy`;
3. conta as tabelas do banco: **zero tabelas** → não há dado a proteger, o backup é pulado (o dump
   de um banco vazio tem menos de 1 KB e cairia na trava de "dump suspeito"). Com qualquer tabela,
   o backup fail-closed roda normalmente, inclusive depois de um `docker stack rm` que preservou o
   volume;
4. migra com a imagem nova;
5. só então faz o `stack deploy` completo (`--prune`), que sobe api, workers, web, agent-runtime,
   landing, redis, rabbitmq e observabilidade.

Por que o recorte e não `docker service create`: o recorte vem do compose de produção, então não
existe uma segunda definição do Postgres para divergir (env, healthcheck, limites, placement,
rede, volume). E `docker compose config` não serve para recortar: ele prefixa volumes e redes com
o nome do projeto compose, e o Postgres montaria um volume vazio.

Se a migração falhar na primeira instalação, só o Postgres fica no ar. Corrija e rode o deploy de
novo: o serviço já existe, então o script segue o caminho de rotina.

---

## 3. Deploy de rotina ("atualizou → deploy")

**Da máquina do Rogério (Windows/PowerShell), um comando:**
```powershell
./scripts/deploy.ps1 -Branch main -Push   # -Push faz git push antes
```
Ou direto no servidor:
```bash
sudo bash /opt/leadium/scripts/deploy.sh main
```

O `deploy.sh` é **idempotente** e faz, em ordem (desde F70-S22 o schema anda **antes** do código):

1. Pré-checagens (Swarm, `network_public`, `.env`)
2. `git reset --hard origin/<branch>` (código exato do remoto). Se o próprio `deploy.sh` mudou
   no pull, ele se re-executa uma vez na versão nova (procure "Re-executando" na saída)
3. `docker compose build` com a tag `:<sha>` (rebuilda só o que mudou — cache de layers). Nada sobe
4. Garante o Postgres do stack no ar (primeira instalação: sobe **só** ele, ver §2.6) e espera o
   healthcheck ficar `healthy`
5. Backup `pg_dump` **fail-closed** (ver "Backup pré-migration" no fim)
6. Migrations (`@hm/db migrate`) com a imagem **nova** da api, num container efêmero na rede
   interna. Até aqui o stack continua 100% na versão anterior
7. `docker stack deploy --prune` (rolling update start-first; remove serviços órfãos do stack)
8. Verifica que cada serviço de app convergiu para `:<sha>` e falha alto se algum ficou para trás

**Se a migração falhar, o deploy aborta antes do passo 7:** nenhum código novo sobe, os serviços
seguem na versão anterior contra o schema atual, e a saída imprime o que fazer e o comando de
restore do backup daquele deploy. Por que a ordem importa: com start-first, a api e os workers
novos entram no ar assim que passam no healthcheck, e o healthcheck não olha o schema. Na ordem
antiga (stack deploy → migrate), o código novo rodava contra o schema velho até a migração
terminar (toda gravação com `enqueueOutbox` falhando, por exemplo), ou para sempre se ela
falhasse.

### 3.1. Regra permanente: migração aditiva primeiro; destrutiva exige expand/contract

Migrar antes de subir o código só é seguro porque, durante a janela entre o passo 6 e o fim do
passo 7, **o código anterior roda contra o schema novo**. Toda migration precisa, portanto, ser
compatível com o código que já está em produção:

- **Aditiva — pode ir no mesmo deploy do código que a usa:** tabela nova, coluna nova nullable ou
  com default, índice novo (`CONCURRENTLY` em tabela grande), CHECK relaxado, função/trigger nova
  que o código velho não percebe.
- **Destrutiva — nunca no mesmo deploy do código:** `DROP` de tabela/coluna, `RENAME`, mudança de
  tipo, `NOT NULL` novo em coluna que o código velho não preenche, CHECK mais restrito, backfill
  que apaga ou reescreve dado.

Destrutiva segue **expand/contract**, em deploys separados:

1. **Expand** (deploy N): migration aditiva (coluna/tabela nova) + código que escreve nos dois
   lugares e lê do novo com fallback no velho. Backfill idempotente, em lotes.
2. **Migrate** (deploy N, ou N+1): o backfill termina; o código passa a ler só do novo. Verifique
   com uma consulta que nenhuma linha depende mais do velho.
3. **Contract** (deploy N+2, depois de o N+1 estar estável em produção): migration que remove o
   velho (`DROP`/`NOT NULL`). Nesse ponto nenhum código em produção lê ou escreve o que está sendo
   removido, então rodar a migration antes do código continua seguro.

Exemplo, renomear `contacts.phone` → `contacts.phone_e164`: N adiciona `phone_e164` e escreve nas
duas; N+1 lê só `phone_e164`; N+2 faz `DROP COLUMN phone`. Um `RENAME` direto quebraria o código
antigo no instante da migração.

Revisão de PR: migration destrutiva sem o deploy de expand já em produção é bloqueio. Rollback
de código com migration no meio: [`rollback-deploy.md`](./rollback-deploy.md) §4.

**Exceção registrada — 0091 (F70-S24):** troca o índice único da outbox e tira o
`SELECT(event_id)` do `hm_app`, o que o `enqueueOutbox` anterior à F70-S24 não suporta. Só é
destrutiva se a 0086 já estiver em produção. Checagem e pré-voos antes de subir (incluindo as
execuções de flow `running` que a F70-S25 reanima no primeiro tick):
[`outbox-operations.md`](./outbox-operations.md) §3 e §4.

---

## 4. Operação

```bash
docker stack services leadium            # visão geral (réplicas, imagem)
docker service logs -f leadium_api       # logs ao vivo (api | web | workers | agent-runtime)
docker service ps leadium_api --no-trunc # histórico/erros de tasks de um serviço
docker stats                             # uso de CPU/RAM em tempo real
```

### Rollback
As imagens são tagueadas pelo **commit** (`leadium-api:<sha>` etc.) — o `deploy.sh`
deriva `APP_VERSION` de `git rev-parse --short HEAD`. Para reverter:
```bash
cd /opt/leadium && git reset --hard <commit-anterior>
sudo bash scripts/deploy.sh main
```
> Importante: tag fixa (`:latest`) NÃO funciona no Swarm — `stack deploy` compara a
> string da tag e não recria o serviço se ela não mudar. Por isso tagueamos por sha.
> Se a imagem `<sha>` antigo ainda existir no nó, o redeploy é instantâneo (sem rebuild).

### Migrations manuais
```bash
set -a; . /opt/leadium/.env; set +a
docker run --rm --network leadium_leadium_internal \
  -e DATABASE_URL="postgresql://$PG_USER:$PG_PASSWORD@postgres:5432/$PG_DB" \
  "leadium-api:$(git -C /opt/leadium rev-parse --short HEAD)" pnpm --filter @hm/db migrate
```

### Backup do banco (Leadium)
```bash
docker exec $(docker ps -qf name=leadium_postgres) \
  pg_dump -U leadium leadium | gzip > /opt/leadium/backups/leadium_$(date +%F).sql.gz
```

---

## 5. Troubleshooting

| Sintoma                                   | Causa provável / ação                                              |
|-------------------------------------------|--------------------------------------------------------------------|
| 404/502 no domínio                        | Traefik ainda não roteou: `docker service ps leadium_web`; confira labels e a rede `network_public`. |
| SSL não emite                             | DNS ainda propagando, ou porta 80 bloqueada (HTTP-01). Aguarde / cheque `docker service logs traefik_traefik`. |
| api `degraded` (503 em /health)           | Postgres/Redis fora: `docker service ps leadium_postgres leadium_redis`. |
| Socket.io não conecta                     | Confirme o router `leadium_app_api` (prio 20) cobrindo `/socket.io`. |
| Build OOM no `web`                        | Falta swap (§2.2) — Next build é pesado em 2 vCPU.                  |
| `Migrations FALHARAM ... ANTES do stack deploy` | Nada do código novo subiu (os serviços seguem na versão anterior). O script já tenta 6 vezes. Leia o erro (pré-voo da migration, `lock_timeout`, dado violando constraint nova), rode a migration manual (§4) para reproduzir, corrija e rode o deploy de novo. Restore só se o banco ficou inconsistente: o comando sai impresso. |
| `Postgres ... não ficou saudável`         | Deploy abortado antes de migrar e de subir código. `docker service ps leadium_postgres --no-trunc` e `docker service logs leadium_postgres`. |
| `Não consegui recortar o bloco do Postgres` | Só na primeira instalação: o layout do `docker-compose.prod.yml` mudou (chaves de topo na coluna 0, serviços com 2 espaços). Nada subiu. |

---

## 6. Notas de segurança & evolução

- **Senha de root da VPS foi exposta uma vez** (compartilhada em chat) → trocar e
  migrar para login **só por chave** (`PasswordAuthentication no` no sshd).
- `.env` vive **só no servidor** (`/opt/leadium/.env`), nunca no git.
- Infra interna (`leadium_internal`) é `internal: true` — Postgres/Redis/RabbitMQ
  **não têm porta no host** nem rota para fora.
- **Próximos passos** (hardening incremental, não bloqueiam o go-live):
  - Tag de imagem por commit → rollback instantâneo.
  - CI (GitHub Actions) buildando/pushando imagens p/ registry em vez de buildar no nó.
  - `pgAdmin`/RabbitMQ UI atrás do Traefik com auth, se necessário.
  - Backups automáticos (cron) do Postgres da Leadium.
  - Papéis de login separados por serviço (hoje api/workers/agent-runtime conectam como o
    superuser `PG_USER`): plano em [`database-login-roles.md`](./database-login-roles.md).

---

## Backup pré-migration (F57-S07)

Desde 2026-09-09, `deploy.sh` faz `pg_dump` **antes** de rodar migrations, em
`/opt/leadium/backups`, nomeado por timestamp UTC + sha do commit implantado. Desde a F70-S22 o
backup e as migrations acontecem com o stack ainda na versão anterior, antes do `stack deploy`.

Única exceção ao backup: banco sem nenhuma tabela (primeira instalação, §2.6). Se a consulta que
conta as tabelas falhar, o deploy aborta, como qualquer outra falha de backup.

**É fail-closed:** se o dump falhar — ou sair suspeito de vazio (< 1 KB) — o deploy **aborta antes
de tocar no banco**. Um deploy que não roda é problema de minutos; uma migration sobre dado sem
backup é problema que pode não ter volta.

O comando de restore é impresso na saída do próprio deploy, de propósito: durante um incidente
ninguém quer procurar a sintaxe do `pg_restore` em documentação.

Retenção: 10 dumps (`BACKUP_KEEP`), com poda automática. Caminho ajustável por `BACKUP_DIR`.

Procedimento completo: [`restore-from-backup.md`](./restore-from-backup.md).

**O que ele não é:** backup contínuo. É um retrato do momento do deploy — se o problema aparecer
horas depois, o restore completo perde essas horas. PITR (`wal-g`/`pgbackrest`) é a resposta certa
para isso e merece slot próprio.
