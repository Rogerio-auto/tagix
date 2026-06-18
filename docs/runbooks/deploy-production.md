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

O `deploy.sh` é **idempotente** e faz, em ordem:
1. `git reset --hard origin/<branch>` (código exato do remoto)
2. `docker compose build` (rebuilda só o que mudou — cache de layers)
3. `docker stack deploy --prune` (rolling update; remove serviços órfãos do stack)
4. Espera Postgres saudável
5. Migrations (`@hm/db migrate` — drizzle versionado)
6. Imprime o status dos serviços

---

## 4. Operação

```bash
docker stack services leadium            # visão geral (réplicas, imagem)
docker service logs -f leadium_api       # logs ao vivo (api | web | workers | agent-runtime)
docker service ps leadium_api --no-trunc # histórico/erros de tasks de um serviço
docker stats                             # uso de CPU/RAM em tempo real
```

### Rollback
Imagens são `:latest` (sem tag por versão neste estágio). Para reverter:
```bash
cd /opt/leadium && git reset --hard <commit-anterior>
sudo bash scripts/deploy.sh main
```
> Evolução planejada: taguear imagens por commit (`leadium-api:<sha>`) para
> rollback instantâneo sem rebuild. Ver §6.

### Migrations manuais
```bash
set -a; . /opt/leadium/.env; set +a
docker run --rm --network leadium_leadium_internal \
  -e DATABASE_URL="postgresql://$PG_USER:$PG_PASSWORD@postgres:5432/$PG_DB" \
  leadium-api:latest pnpm --filter @hm/db migrate
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
| `migration falhou`                        | Postgres ainda acordando: o script já tem retry; rode migration manual (§4). |

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
