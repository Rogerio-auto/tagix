# Runbook — Ambiente de desenvolvimento (WSL2 + Ubuntu 24.04)

> **Para quem:** Rogério (primeira vez fazendo setup de Linux para dev). Documento desenhado para ser executado **manualmente passo-a-passo** ou **por um agente IA** com acesso ao terminal.
> **Tempo estimado:** 60–90 minutos (incluindo downloads).
> **Resultado:** repo Highermind v2 clonado, stack Docker subindo, API + agent-runtime Python + frontend rodando localmente, todos os serviços de infra (Postgres, Redis, RabbitMQ) operacionais.

---

## 0. Como ler este runbook

Cada passo tem três partes:
1. **O que / Por quê** — uma linha explicando o objetivo.
2. **Comando** — bloco copy-paste pronto.
3. **Como saber que deu certo** — output esperado ou comando de verificação.

Se um passo falhar, vá direto pra §13 "Troubleshooting" antes de tentar de novo.

Convenções:
- `$` no início = comando rodado dentro do **Ubuntu (WSL2)**.
- `PS>` no início = comando rodado dentro do **PowerShell do Windows** (como administrador).
- Arquivos com prefixo `~/` ficam no home do usuário Linux (`/home/<user>/`).

---

## 1. O que é WSL2 (em 5 linhas)

WSL2 = **Windows Subsystem for Linux 2**. É uma máquina virtual Linux completa rodando dentro do Windows 11, com kernel Linux real e integração total com o filesystem do Windows e o VS Code. Você vai abrir um terminal Ubuntu como se fosse um app do Windows. Docker, Node, Python, Git, tudo roda nativo no Ubuntu — sem performance penalty perceptível, sem dual-boot, sem risco de quebrar nada do Windows.

É como ter dois computadores no mesmo hardware sem precisar reiniciar.

---

## 2. Pré-requisitos

| Item | Mínimo | Verificação |
|---|---|---|
| Windows | 11 (qualquer edição) | `winver` no Run |
| RAM | 16 GB (8 vão pro WSL2 em pico) | Task Manager > Performance |
| Disco livre | 40 GB | Explorer > Este Computador |
| Virtualização (BIOS) | Habilitada (VT-x ou AMD-V) | Task Manager > Performance > CPU > "Virtualization: Enabled" |
| Conta de admin | Sim (necessária pra instalar WSL) | — |

**Se virtualização estiver `Disabled`:** reinicie no BIOS/UEFI e ative `Intel VT-x` ou `AMD-V`. Sem isso, WSL2 não roda.

---

## 3. Instalar WSL2 + Ubuntu 24.04

### 3.1 Abrir PowerShell como administrador

Botão direito no menu Iniciar → "Terminal (Admin)" ou "Windows PowerShell (Admin)".

### 3.2 Instalar WSL com Ubuntu 24.04

```powershell
PS> wsl --install -d Ubuntu-24.04
```

**O que acontece:** baixa o kernel WSL, habilita a feature do Windows, instala Ubuntu 24.04 LTS. Pode pedir reinicialização — reinicie e rode de novo se necessário.

**Como saber que deu certo:**
```powershell
PS> wsl --list --verbose
  NAME            STATE           VERSION
  Ubuntu-24.04    Running         2
```

Versão tem que ser `2`. Se aparecer `1`:

```powershell
PS> wsl --set-version Ubuntu-24.04 2
PS> wsl --set-default Ubuntu-24.04
```

### 3.3 Primeiro boot do Ubuntu

Abra o menu Iniciar e procure "Ubuntu 24.04". Clique. Vai pedir para criar **usuário Linux** (não precisa ser igual ao Windows) e **senha**.

> Anote a senha. Você vai usar com `sudo` para tudo administrativo. Não é a senha do Windows.

Quando o prompt mostrar algo como `rogerio@DESKTOP-XYZ:~$`, está pronto.

### 3.4 Atualizar o sistema

```bash
$ sudo apt update && sudo apt upgrade -y
```

Pode levar 5 minutos. Senha pedida = a que você criou no passo anterior.

---

## 4. Instalar Git e configurar identidade

```bash
$ sudo apt install -y git
$ git config --global user.name "Rogério Viana"
$ git config --global user.email "rogerio5566.ro@gmail.com"
$ git config --global init.defaultBranch main
$ git config --global pull.rebase false
```

**Verificar:**
```bash
$ git --version
git version 2.43.0  # ou superior
```

---

## 5. Instalar Node.js 22 via `fnm`

`fnm` é um gerenciador de versões do Node super rápido. Evita problemas de permission do `npm` global e permite trocar de versão por projeto.

```bash
$ curl -fsSL https://fnm.vercel.app/install | bash
$ source ~/.bashrc
$ fnm install 22
$ fnm default 22
$ fnm use 22
```

**Verificar:**
```bash
$ node --version
v22.x.x
$ npm --version
10.x.x
```

### 5.1 Instalar pnpm

```bash
$ corepack enable
$ corepack prepare pnpm@latest --activate
```

**Verificar:**
```bash
$ pnpm --version
9.x.x
```

---

## 6. Instalar Python 3.13 via `uv`

`uv` é o gerenciador de Python mais rápido que existe hoje (escrito em Rust pela Astral, mesma turma do ruff). Substitui pyenv + venv + pip + poetry com uma ferramenta só.

```bash
$ curl -LsSf https://astral.sh/uv/install.sh | sh
$ source ~/.bashrc
$ uv python install 3.13
```

**Verificar:**
```bash
$ uv --version
uv 0.x.x
$ uv run python --version
Python 3.13.x
```

---

## 7. Instalar Docker (via Docker Desktop)

**Atenção:** Docker dentro do Ubuntu WSL2 é tecnicamente possível, mas o caminho mais limpo é **Docker Desktop no Windows com integração WSL2 ativada**. Assim você gerencia containers tanto via Windows quanto via terminal Ubuntu, sem conflito.

### 7.1 Baixar Docker Desktop

No Windows, abra o navegador e vá em:
```
https://www.docker.com/products/docker-desktop/
```

Baixe "Docker Desktop for Windows". Tamanho ~700MB.

### 7.2 Instalar

Rodar o `.exe` baixado. Aceitar tudo. Ele detecta o WSL2 automaticamente.

### 7.3 Habilitar integração WSL2

Abrir **Docker Desktop** (no Windows) → Settings (⚙) → Resources → WSL Integration:
- ✅ Enable integration with my default WSL distro
- ✅ Ubuntu-24.04 (toggle ligado)

Clicar **Apply & Restart**.

### 7.4 Verificar do lado do Ubuntu

Abra o terminal Ubuntu (pode fechar e reabrir):

```bash
$ docker --version
Docker version 27.x.x, build ...
$ docker compose version
Docker Compose version v2.x.x
$ docker run --rm hello-world
Hello from Docker!
```

Se aparecer `Hello from Docker!`, integração OK.

---

## 8. Instalar VS Code com extensão WSL

### 8.1 Instalar VS Code no Windows

Se ainda não tem:
```
https://code.visualstudio.com/Download
```

### 8.2 Instalar extensão "WSL"

Abra VS Code → painel de extensões (Ctrl+Shift+X) → buscar **"WSL"** (Microsoft, oficial) → Install.

### 8.3 Abrir VS Code conectado ao Ubuntu

No terminal Ubuntu:
```bash
$ cd ~
$ code .
```

Da primeira vez baixa o VS Code Server dentro do WSL (alguns segundos). Depois abre a janela do VS Code já conectada ao Ubuntu — você vê **"WSL: Ubuntu-24.04"** no canto inferior esquerdo verde.

### 8.4 Extensões recomendadas (instale dentro do contexto WSL)

Com a janela WSL aberta, na aba de extensões instale (cada uma vai aparecer com badge "Install in WSL: Ubuntu"):

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

## 9. Clonar o repo

> **Regra crítica:** o repo fica **dentro do filesystem do Ubuntu** (`~/projects/`), **NÃO** em `/mnt/c/Users/...`. Performance de I/O em `/mnt/c` é 10× pior. **Esta é a principal causa de "WSL2 está lento" em forums.**

```bash
$ mkdir -p ~/projects
$ cd ~/projects
$ git clone https://github.com/<seu-usuario>/highermind-v2.git
$ cd highermind-v2
$ code .
```

(Se o repo for privado, configure SSH primeiro — vide §11.)

---

## 10. Subir a stack dev local

> Atenção: este runbook assume que `infra/docker/docker-compose.dev.yml` já existe no repo (criado durante `/hm-init` na fase F0-S02). Se ainda não existe, este passo precisa esperar.

### 10.1 Copiar .env.example para .env

```bash
$ cp .env.example .env
$ nano .env   # ou: code .env
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
AGENT_RUNTIME_TOKEN=$(openssl rand -hex 32)

# Meta (deixar vazio em dev; configurar quando for testar webhook real)
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
```

### 10.2 Subir infra base (Postgres + Redis + RabbitMQ + WAHA)

```bash
$ docker compose -f infra/docker/docker-compose.dev.yml up -d postgres redis rabbitmq waha
```

Aguardar ~30 segundos. Verificar:

```bash
$ docker compose -f infra/docker/docker-compose.dev.yml ps
```

Todos com `Status: Up (healthy)`.

### 10.3 Rodar migrations Drizzle

```bash
$ pnpm install
$ pnpm db:migrate
$ pnpm db:seed     # cria workspace de dev + owner + 5 agent templates + catálogo OpenRouter inicial
```

### 10.4 Subir agent-runtime Python

Em **outro terminal Ubuntu** (mantém o primeiro pra logs):

```bash
$ cd ~/projects/highermind-v2/apps/agent-runtime
$ uv sync                                    # instala dependências Python
$ uv run uvicorn app.main:app --reload --port 8001
```

Verificar em terceiro terminal:

```bash
$ curl http://localhost:8001/healthz
{"status":"ok"}
```

### 10.5 Subir API Node

Em outro terminal:

```bash
$ cd ~/projects/highermind-v2
$ pnpm --filter @hm/api dev
```

Verificar:

```bash
$ curl http://localhost:3001/health
{"status":"ok"}
```

### 10.6 Subir workers Node

Em outro terminal:

```bash
$ pnpm --filter @hm/workers dev:all
```

(Sobe inbound + outbound + media + campaigns + flows + scheduler.)

### 10.7 Subir frontend (Next.js)

Em outro terminal:

```bash
$ pnpm --filter @hm/web dev
```

O terminal mostra:
```
  ▲ Next.js 15.x.x
  - Local:        http://localhost:3000
  - Network:      http://0.0.0.0:3000
  ✓ Ready in 1.2s
```

Abra `http://localhost:3000` no navegador do Windows — funciona direto, WSL2 faz forward de porta automático.

---

## 11. (Opcional) Configurar SSH para GitHub

Se o repo for privado e você não quer usar HTTPS+token toda hora:

```bash
$ ssh-keygen -t ed25519 -C "rogerio5566.ro@gmail.com" -f ~/.ssh/id_ed25519 -N ""
$ cat ~/.ssh/id_ed25519.pub
```

Copie a saída (linha que começa com `ssh-ed25519 AAAA...`).

No navegador, vá em github.com → Settings → SSH and GPG keys → New SSH key → cola.

Testar:
```bash
$ ssh -T git@github.com
Hi <user>! You've successfully authenticated...
```

Mudar remote do repo para SSH:
```bash
$ cd ~/projects/highermind-v2
$ git remote set-url origin git@github.com:<seu-usuario>/highermind-v2.git
```

---

## 12. Smoke test end-to-end

Cole isso num terminal Ubuntu para verificar que tudo está conversando:

```bash
$ curl http://localhost:3001/health
{"status":"ok","db":"connected","redis":"connected","rabbit":"connected"}

$ curl http://localhost:8001/healthz
{"status":"ok"}

$ curl http://localhost:8001/openapi.json | head -20
# deve mostrar JSON com paths de /agents/{agent_id}/run etc.

$ docker compose -f infra/docker/docker-compose.dev.yml exec postgres psql -U hm -d highermind -c "SELECT count(*) FROM agent_templates;"
 count
-------
     5
```

Frontend em `http://localhost:3000` deve abrir a tela de login.

Se os quatro passos acima funcionarem, **ambiente está pronto**.

---

## 13. Troubleshooting

### "wsl: Acesso negado" ou virtualização não habilitada

→ Reinicie o PC, entre no BIOS/UEFI (geralmente F2 ou Delete no boot), ative `Intel VT-x` ou `AMD-V` (também chamado SVM em algumas BIOS). Salve e saia.

### "Cannot connect to Docker daemon"

→ Docker Desktop não está rodando no Windows. Abra o app. Espere o ícone na bandeja ficar estável (não pulsando).

### "Port 5432 already in use"

→ Você tem outro Postgres rodando (talvez instalado no Windows). Pare-o ou mude a porta do compose dev. Para parar Postgres do Windows:
```powershell
PS> Stop-Service postgresql-x64-16
```

### WSL2 lento ou comendo memória demais

→ Crie `C:\Users\<seu-usuario>\.wslconfig`:
```ini
[wsl2]
memory=8GB
processors=4
swap=4GB
```
Reinicie WSL:
```powershell
PS> wsl --shutdown
```
Abra o Ubuntu de novo.

### "pnpm: command not found" depois de instalar

→ `corepack` ainda não ativou pro shell atual. Rode `source ~/.bashrc` ou feche/abra o terminal.

### `code .` não abre VS Code

→ Você não instalou a extensão **WSL** no VS Code do Windows ainda. Volte ao §8.2.

### Performance de I/O ruim no projeto

→ Você clonou em `/mnt/c/...` em vez de `~/projects`. Mova:
```bash
$ mv /mnt/c/Users/<user>/highermind-v2 ~/projects/
```

### Docker Compose dá erro de "permission denied" em volume

→ Seu usuário Linux não está no grupo `docker`. Rode:
```bash
$ sudo usermod -aG docker $USER
$ newgrp docker
```

### Migração Drizzle falha em "extension vector does not exist"

→ A imagem Postgres do compose dev é `pgvector/pgvector:pg16` (já vem com a extensão). Se você apontou pra `postgres:16` puro, troca pra `pgvector/pgvector:pg16` no `docker-compose.dev.yml`.

### Agent-runtime falha em "PostgresSaver tables not initialized"

→ Primeira execução precisa criar as tabelas `langgraph_*`. Rode:
```bash
$ cd apps/agent-runtime
$ uv run python -m app.scripts.init_checkpointer
```

---

## 13a. Instalar Claude Code (CLI) no Ubuntu

Claude Code roda do **lado WSL** porque o repo está lá. Não instale no Windows.

```bash
$ npm install -g @anthropic-ai/claude-code
$ claude --version
```

A extensão do Claude Code no VS Code também é instalada **"in WSL: Ubuntu-24.04"** (mesmo padrão das outras do §8.4). O VS Code Server do WSL detecta automaticamente o CLI quando você abre o projeto.

---

## 13b. Acessar dev server de outros dispositivos (LAN)

Para abrir `http://<seu-ip>:3000` (Next.js frontend) no celular/tablet/outro PC da mesma rede.

### Passo 1: Mirrored networking no WSL2

Edite `C:\Users\<seu-user>\.wslconfig` (criar se não existe):

```ini
[wsl2]
networkingMode=mirrored
firewall=true
dnsTunneling=true
autoProxy=true
memory=8GB
processors=4
```

Aplicar:
```powershell
PS> wsl --shutdown
```

### Passo 2: Liberar firewall do Windows

PowerShell admin:

```powershell
PS> New-NetFirewallRule -DisplayName "HM Dev Next.js"  -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
PS> New-NetFirewallRule -DisplayName "HM Dev API"      -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
PS> New-NetFirewallRule -DisplayName "HM Dev Agent"    -Direction Inbound -Protocol TCP -LocalPort 8001 -Action Allow -Profile Private
```

`Private` apenas; nunca `Public`.

### Passo 3: Subir dev servers com `--host 0.0.0.0`

```bash
$ pnpm --filter @hm/web dev -- -H 0.0.0.0 -p 3000              # Next.js (App Router)
$ uv run uvicorn app.main:app --host 0.0.0.0 --port 8001       # FastAPI
```

API Node já tem que estar listando em `0.0.0.0` no código:
```ts
app.listen(3001, '0.0.0.0', () => { ... });
```

### Passo 4: Descobrir seu IP na rede

```powershell
PS> ipconfig | findstr IPv4
   Endereço IPv4. . . . . . . . . . . . . . : 192.168.0.42
```

### Passo 5: Acessar do outro device

Mesma Wi-Fi, navegador → `http://192.168.0.42:3000`.

---

## 13c. Receber webhook Meta no dev local (Cloudflare Tunnel)

Meta WhatsApp/Instagram só chama URLs HTTPS públicas. Pra testar webhook em desenvolvimento sem deploy, use **Cloudflare Tunnel** (grátis, sem cadastro):

```bash
$ sudo apt install -y cloudflared
$ cloudflared tunnel --url http://localhost:3001
```

A saída mostra:
```
https://xxxx-xxxx-xxxx.trycloudflare.com
```

Cole essa URL como endpoint de webhook no Meta App Dashboard. Funciona enquanto o terminal estiver aberto.

**Alternativa:** `ngrok http 3001` (precisa cadastro, mas tem dashboard de inspeção de requests bem útil).

---

## 14. Workflow diário (depois que tudo estiver pronto)

Cada manhã, basicamente:

```bash
# Terminal 1 — infra
$ cd ~/projects/highermind-v2
$ docker compose -f infra/docker/docker-compose.dev.yml up -d

# Terminal 2 — agent-runtime Python
$ cd apps/agent-runtime
$ uv run uvicorn app.main:app --reload --port 8001

# Terminal 3 — backend Node
$ pnpm --filter @hm/api dev

# Terminal 4 — workers
$ pnpm --filter @hm/workers dev:all

# Terminal 5 — frontend
$ pnpm --filter @hm/web dev
```

VS Code com `code .` no root do repo. Use **tmux** ou **VS Code Terminal split** para gerenciar os 5 terminais sem afogar.

Quando terminar o dia:
```bash
$ docker compose -f infra/docker/docker-compose.dev.yml stop
```

(`stop` mantém os dados em volumes; `down` apaga tudo — use `stop` no dia-a-dia.)

---

## 15. Recursos extras

| Coisa | Onde |
|---|---|
| Documentação oficial WSL | https://learn.microsoft.com/pt-br/windows/wsl/ |
| Documentação `fnm` | https://github.com/Schniz/fnm |
| Documentação `uv` | https://docs.astral.sh/uv/ |
| OpenRouter docs | https://openrouter.ai/docs |
| Drizzle ORM docs | https://orm.drizzle.team/docs/overview |
| LangGraph Python docs | https://langchain-ai.github.io/langgraph/ |

---

## 16. Quando você quiser ir pra Linux nativo no futuro

WSL2 cobre 99% do dev. O 1% restante (drivers gráficos exóticos, dual-display 4K muito grande, GPU passthrough) pode pedir Linux nativo. Se chegar lá, abre um runbook irmão `dev-environment-native-linux.md` — porém na prática, **muita gente nunca precisa migrar**. Vercel, Hetzner, GitHub Actions, todos rodam Linux mesmo; seu WSL2 é a mesma coisa.

---

> Runbook mantido por: Rogério. Mudanças significativas no stack (versão de Node, Python, Postgres) exigem update aqui.
