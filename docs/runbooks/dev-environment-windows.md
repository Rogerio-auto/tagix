# Runbook — Ambiente de desenvolvimento (Windows 11 nativo)

> **Para quem:** Rogério, desenvolvendo o `tagix` (Highermind v2) **direto no Windows**, sem WSL/Linux.
> **Tempo estimado:** 40–70 minutos (incluindo downloads).
> **Resultado:** repo clonado, stack Docker subindo, API + agent-runtime Python + frontend rodando localmente no Windows, infra (Postgres, Redis, RabbitMQ) operacional via Docker Desktop.

---

## 0. Como ler este runbook

Cada passo tem três partes:
1. **O que / Por quê** — uma linha explicando o objetivo.
2. **Comando** — bloco copy-paste pronto.
3. **Como saber que deu certo** — output esperado ou comando de verificação.

Se um passo falhar, vá direto pra §12 "Troubleshooting" antes de tentar de novo.

Convenções:
- `PS>` no início = comando rodado no **PowerShell do Windows**. Onde precisar de privilégio (instalar feature do SO), está marcado **(Admin)**.
- Caminhos com `C:\Users\Ueverton\...` são exemplos do meu setup atual — ajuste pro seu usuário se mudar.

> **Por que Windows nativo e não WSL2:** todo o stack do projeto (Node, Python via `uv`, Docker, Postgres, Redis, RabbitMQ) roda perfeitamente no Windows. O único uso de Linux aqui é **invisível**: o Docker Desktop usa um backend WSL2 internamente pra rodar os containers — mas você nunca abre um terminal Linux nem desenvolve dentro dele. Todo o trabalho é no PowerShell + VS Code do Windows.

---

## 1. Pré-requisitos

| Item | Mínimo | Verificação |
|---|---|---|
| Windows | 11 (qualquer edição) | `winver` no Run |
| RAM | 16 GB | Task Manager > Performance |
| Disco livre | 40 GB | Explorer > Este Computador |
| Virtualização (BIOS) | Habilitada (VT-x / AMD-V) | Task Manager > Performance > CPU > "Virtualization: Enabled" |
| Conta de admin | Sim (necessária pra Docker Desktop + features) | — |
| `winget` | Já vem no Windows 11 | `winget --version` no PowerShell |

**Se virtualização estiver `Disabled`:** reinicie no BIOS/UEFI e ative `Intel VT-x` ou `AMD-V` (em algumas BIOS é `SVM`). Sem isso, o Docker Desktop não roda.

---

## 2. Git e identidade

O Git provavelmente já está instalado. Se não:

```powershell
PS> winget install --id Git.Git -e --source winget
```

Feche e reabra o PowerShell, depois configure a identidade:

```powershell
PS> git config --global user.name "Rogério Viana"
PS> git config --global user.email "rogerio5566.ro@gmail.com"
PS> git config --global init.defaultBranch main
PS> git config --global pull.rebase false
```

**Verificar:**
```powershell
PS> git --version
git version 2.4x.x  # ou superior
```

---

## 3. Node.js 22 via `fnm`

`fnm` (Fast Node Manager) é rápido, multiplataforma e permite trocar de versão por projeto — evita os problemas de permissão do instalador global.

```powershell
PS> winget install --id Schniz.fnm -e
```

Feche e reabra o PowerShell. Adicione o `fnm` ao seu profile pra carregar a versão automaticamente:

```powershell
PS> if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }
PS> Add-Content $PROFILE 'fnm env --use-on-cd | Out-String | Invoke-Expression'
```

Reabra o PowerShell e instale o Node:

```powershell
PS> fnm install 22
PS> fnm default 22
PS> fnm use 22
```

**Verificar:**
```powershell
PS> node --version
v22.x.x
PS> npm --version
10.x.x
```

### 3.1 pnpm via corepack

```powershell
PS> corepack enable
PS> corepack prepare pnpm@latest --activate
```

**Verificar:**
```powershell
PS> pnpm --version
9.x.x  # ou superior
```

---

## 4. Python 3.13 via `uv`

`uv` é o gerenciador de Python mais rápido que existe (escrito em Rust pela Astral, mesma turma do ruff). Substitui pyenv + venv + pip + poetry com uma ferramenta só. Funciona nativo no Windows.

```powershell
PS> powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Feche e reabra o PowerShell, depois instale o Python:

```powershell
PS> uv python install 3.13
```

**Verificar:**
```powershell
PS> uv --version
uv 0.x.x
PS> uv run python --version
Python 3.13.x
```

---

## 5. Docker Desktop

Roda os containers de infra (Postgres, Redis, RabbitMQ, WAHA). No Windows ele usa um backend WSL2 automaticamente — você não precisa configurar nem abrir nada de Linux.

```powershell
PS> winget install --id Docker.DockerDesktop -e
```

Depois de instalar:
1. Abra o **Docker Desktop** (menu Iniciar). Na primeira vez ele pode pedir pra instalar/atualizar o componente WSL2 — aceite (é só o backend, não um ambiente de dev).
2. Espere o ícone na bandeja ficar estável (baleia parada, não pulsando).
3. Settings (⚙) → General → confirme **"Use the WSL 2 based engine"** marcado.

**Verificar (no PowerShell):**
```powershell
PS> docker --version
Docker version 27.x.x, build ...
PS> docker compose version
Docker Compose version v2.x.x
PS> docker run --rm hello-world
Hello from Docker!
```

Se aparecer `Hello from Docker!`, está pronto.

---

## 6. VS Code + extensões

```powershell
PS> winget install --id Microsoft.VisualStudioCode -e
```

Abra o VS Code e instale as extensões (Ctrl+Shift+X):

- **ESLint** (Microsoft)
- **Prettier - Code formatter** (Prettier)
- **Tailwind CSS IntelliSense** (Tailwind Labs)
- **Python** (Microsoft)
- **Pylance** (Microsoft)
- **Ruff** (Astral Software)
- **Docker** (Microsoft)
- **GitLens** (GitKraken) — opcional, ajuda em blame/history
- **Error Lens** (Alexander) — opcional, inline errors

---

## 7. Clonar o repo

O repo já está em `C:\Users\Ueverton\Desktop\Saas Tagix`. Se for clonar de novo num diretório limpo:

```powershell
PS> New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\projects" | Out-Null
PS> Set-Location "$env:USERPROFILE\projects"
PS> git clone https://github.com/Rogerio-auto/tagix.git
PS> Set-Location tagix
PS> code .
```

> **Performance:** mantenha o repo num disco **SSD/NVMe**. Evite pastas sincronizadas por OneDrive/Dropbox (a sincronização contínua de `node_modules` e `.next` mata a performance de build). Se a sua Área de Trabalho estiver sob OneDrive, considere mover o projeto pra `C:\Users\Ueverton\projects\`.

---

## 8. Subir a stack dev local

> Atenção: este runbook assume que `infra/docker/docker-compose.dev.yml` já existe no repo (criado durante `/hm-init` na fase F0-S02). Se ainda não existe, este passo precisa esperar.

### 8.1 Copiar .env.example para .env

```powershell
PS> Copy-Item .env.example .env
PS> code .env
```

Preencha os secrets mínimos para dev:

```env
# Postgres
DATABASE_URL=postgres://hm:hm@localhost:5432/highermind

# Redis
REDIS_URL=redis://localhost:6379

# RabbitMQ
AMQP_URL=amqp://hm:hm@localhost:5672

# Storage (local em dev)
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=./tmp/storage

# Auth (Supabase — pegue do dashboard https://supabase.com)
SUPABASE_URL=https://<seu-projeto>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_KEY=<service-key>

# LLM Router (pegue em https://openrouter.ai/keys)
OPENROUTER_API_KEY=sk-or-v1-...

# OpenAI direto (embeddings/whisper/vision; pegue em https://platform.openai.com/api-keys)
OPENAI_API_KEY=sk-proj-...

# Agent runtime (token interno; gere qualquer string aleatória)
AGENT_RUNTIME_TOKEN=cole-aqui-uma-string-aleatoria

# Meta (deixar vazio em dev; configurar quando for testar webhook real)
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
```

Para gerar o `AGENT_RUNTIME_TOKEN` aleatório no PowerShell:

```powershell
PS> -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
```

### 8.2 Subir infra base (Postgres + Redis + RabbitMQ + WAHA)

```powershell
PS> docker compose -f infra/docker/docker-compose.dev.yml up -d postgres redis rabbitmq waha
```

Aguardar ~30 segundos. Verificar:

```powershell
PS> docker compose -f infra/docker/docker-compose.dev.yml ps
```

Todos com `Status: Up (healthy)`.

### 8.3 Rodar migrations Drizzle

```powershell
PS> pnpm install
PS> pnpm db:migrate
PS> pnpm db:seed     # cria workspace de dev + owner + 5 agent templates + catálogo OpenRouter inicial
```

### 8.4 Subir agent-runtime Python

Em **outro terminal PowerShell** (mantém o primeiro pra logs):

```powershell
PS> Set-Location "$env:USERPROFILE\projects\tagix\apps\agent-runtime"
PS> uv sync                                          # instala dependências Python
PS> uv run uvicorn app.main:app --reload --port 8001
```

Verificar em terceiro terminal:

```powershell
PS> curl http://localhost:8001/healthz
{"status":"ok"}
```

### 8.5 Subir API Node

Em outro terminal:

```powershell
PS> Set-Location "$env:USERPROFILE\projects\tagix"
PS> pnpm --filter @hm/api dev
```

Verificar:

```powershell
PS> curl http://localhost:3001/health
{"status":"ok"}
```

### 8.6 Subir workers Node

Em outro terminal:

```powershell
PS> pnpm --filter @hm/workers dev:all
```

(Sobe inbound + outbound + media + campaigns + flows + scheduler.)

### 8.7 Subir frontend (Next.js)

Em outro terminal:

```powershell
PS> pnpm --filter @hm/web dev
```

O terminal mostra:
```
  ▲ Next.js 15.x.x
  - Local:        http://localhost:3000
  ✓ Ready in 1.2s
```

Abra `http://localhost:3000` no navegador.

> **Dica:** o **Windows Terminal** (já vem no Windows 11) deixa abrir várias abas/painéis no mesmo lugar. `Alt+Shift+D` divide o painel. Use um painel por serviço (infra logs, agent-runtime, api, workers, web) em vez de 5 janelas soltas.

---

## 9. (Opcional) Configurar SSH para GitHub

Se o repo for privado e você não quer usar HTTPS+token toda hora:

```powershell
PS> ssh-keygen -t ed25519 -C "rogerio5566.ro@gmail.com" -f "$env:USERPROFILE\.ssh\id_ed25519" -N '""'
PS> Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
```

Copie a saída (linha que começa com `ssh-ed25519 AAAA...`).

No navegador, vá em github.com → Settings → SSH and GPG keys → New SSH key → cola.

Testar:
```powershell
PS> ssh -T git@github.com
Hi <user>! You've successfully authenticated...
```

Mudar remote do repo para SSH:
```powershell
PS> git remote set-url origin git@github.com:Rogerio-auto/tagix.git
```

---

## 10. Smoke test end-to-end

Cole isso num terminal PowerShell para verificar que tudo está conversando:

```powershell
PS> curl http://localhost:3001/health
{"status":"ok","db":"connected","redis":"connected","rabbit":"connected"}

PS> curl http://localhost:8001/healthz
{"status":"ok"}

PS> docker compose -f infra/docker/docker-compose.dev.yml exec postgres psql -U hm -d highermind -c "SELECT count(*) FROM agent_templates;"
 count
-------
     5
```

Frontend em `http://localhost:3000` deve abrir a tela de login.

Se tudo acima funcionar, **ambiente está pronto**.

---

## 11. Webhook Meta no dev local (Cloudflare Tunnel)

Meta WhatsApp/Instagram só chama URLs HTTPS públicas. Pra testar webhook em desenvolvimento sem deploy, use **Cloudflare Tunnel** (grátis, sem cadastro):

```powershell
PS> winget install --id Cloudflare.cloudflared -e
PS> cloudflared tunnel --url http://localhost:3001
```

A saída mostra:
```
https://xxxx-xxxx-xxxx.trycloudflare.com
```

Cole essa URL como endpoint de webhook no Meta App Dashboard. Funciona enquanto o terminal estiver aberto.

**Alternativa:** `ngrok http 3001` (precisa cadastro, mas tem dashboard de inspeção de requests bem útil).

---

## 12. Troubleshooting

### "Virtualização não habilitada" / Docker não sobe

→ Reinicie o PC, entre no BIOS/UEFI (geralmente F2 ou Delete no boot), ative `Intel VT-x` / `AMD-V` (também chamado SVM). Salve e saia.

### "Cannot connect to Docker daemon" / "error during connect"

→ Docker Desktop não está rodando. Abra o app, espere o ícone da bandeja ficar estável (baleia parada).

### "Port 5432 already in use"

→ Você tem outro Postgres rodando (talvez instalado no Windows). Pare-o ou mude a porta do compose dev. Para parar Postgres do Windows:
```powershell
PS> Stop-Service postgresql-x64-16   # (Admin)
```

### `fnm`/`uv`/`pnpm` "command not found" depois de instalar

→ O PATH só atualiza em terminais novos. Feche e reabra o PowerShell. Se persistir, confirme que o `winget` instalou (ex.: `winget list Schniz.fnm`) e que o profile carrega o `fnm` (§3).

### `irm ... | iex` bloqueado por ExecutionPolicy

→ Rode o instalador com bypass pontual (não muda a policy global):
```powershell
PS> powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### Migração Drizzle falha em "extension vector does not exist"

→ A imagem Postgres do compose dev é `pgvector/pgvector:pg16` (já vem com a extensão). Se você apontou pra `postgres:16` puro, troque pra `pgvector/pgvector:pg16` no `docker-compose.dev.yml`.

### Agent-runtime falha em "PostgresSaver tables not initialized"

→ Primeira execução precisa criar as tabelas `langgraph_*`. Rode:
```powershell
PS> Set-Location apps\agent-runtime
PS> uv run python -m app.scripts.init_checkpointer
```

### Build lento / I/O ruim

→ Verifique se o projeto NÃO está numa pasta sincronizada por OneDrive. Mova pra `C:\Users\Ueverton\projects\`. Confirme também que o repo está em disco SSD/NVMe.

### `curl` retorna objeto estranho em vez do JSON

→ No PowerShell, `curl` é alias de `Invoke-WebRequest`. Para ver só o corpo, use `curl http://localhost:3001/health | Select-Object -ExpandProperty Content`, ou instale o curl real (`winget install cURL.cURL`) e chame `curl.exe`.

---

## 13. Instalar Claude Code (CLI)

```powershell
PS> npm install -g @anthropic-ai/claude-code
PS> claude --version
```

A configuração global do Claude Code fica em `C:\Users\Ueverton\.claude\` (CLAUDE.md, settings.json, skills). Veja o runbook [`claude-code-sync.md`](./claude-code-sync.md) pra detalhes de backup/sync.

---

## 14. Acessar dev server de outros dispositivos (LAN)

Para abrir `http://<seu-ip>:3000` (Next.js) no celular/tablet/outro PC da mesma rede.

### Passo 1: Liberar firewall do Windows (Admin)

```powershell
PS> New-NetFirewallRule -DisplayName "HM Dev Next.js" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
PS> New-NetFirewallRule -DisplayName "HM Dev API"     -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
PS> New-NetFirewallRule -DisplayName "HM Dev Agent"   -Direction Inbound -Protocol TCP -LocalPort 8001 -Action Allow -Profile Private
```

`Private` apenas; nunca `Public`.

### Passo 2: Subir dev servers ouvindo em todas as interfaces

```powershell
PS> pnpm --filter @hm/web dev -- -H 0.0.0.0 -p 3000              # Next.js
PS> uv run uvicorn app.main:app --host 0.0.0.0 --port 8001       # FastAPI
```

API Node já tem que estar listando em `0.0.0.0` no código:
```ts
app.listen(3001, '0.0.0.0', () => { ... });
```

### Passo 3: Descobrir seu IP e acessar

```powershell
PS> ipconfig | Select-String IPv4
   Endereço IPv4. . . . . . . . . . . . . . : 192.168.0.42
```

Mesma Wi-Fi, no outro device: `http://192.168.0.42:3000`.

---

## 15. Workflow diário

Cada manhã, basicamente (um painel do Windows Terminal por bloco):

```powershell
# Painel 1 — infra
PS> Set-Location "$env:USERPROFILE\projects\tagix"
PS> docker compose -f infra/docker/docker-compose.dev.yml up -d

# Painel 2 — agent-runtime Python
PS> Set-Location apps\agent-runtime
PS> uv run uvicorn app.main:app --reload --port 8001

# Painel 3 — backend Node
PS> pnpm --filter @hm/api dev

# Painel 4 — workers
PS> pnpm --filter @hm/workers dev:all

# Painel 5 — frontend
PS> pnpm --filter @hm/web dev
```

Quando terminar o dia:
```powershell
PS> docker compose -f infra/docker/docker-compose.dev.yml stop
```

(`stop` mantém os dados em volumes; `down` apaga tudo — use `stop` no dia-a-dia.)

---

## 16. Recursos extras

| Coisa | Onde |
|---|---|
| Documentação `fnm` | https://github.com/Schniz/fnm |
| Documentação `uv` | https://docs.astral.sh/uv/ |
| Docker Desktop (Windows) | https://docs.docker.com/desktop/install/windows-install/ |
| OpenRouter docs | https://openrouter.ai/docs |
| Drizzle ORM docs | https://orm.drizzle.team/docs/overview |
| LangGraph Python docs | https://langchain-ai.github.io/langgraph/ |

---

> Runbook mantido por: Rogério. Mudanças significativas no stack (versão de Node, Python, Postgres) exigem update aqui.
