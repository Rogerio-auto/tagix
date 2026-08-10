---
id: F57-S06
title: Dev compose — bind em loopback, portas sem colisão e WAHA pinado/autenticado
phase: F57
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - infra/docker/docker-compose.dev.yml
  - docs/runbooks/dev-environment-windows.md
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S06 — Colisão silenciosa de portas no dev + WAHA sem pin e sem auth

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). Reproduzido na máquina do
> fundador. O padrão Higher Mind pede *"Ports documentados e não conflitantes com
> outros projetos"*.

## Objetivo

Fazer `docker compose up` no dev funcionar em máquina que já roda outros serviços —
e falhar de forma legível quando não puder.

## Contexto / causa raiz (verificada na máquina do fundador)

### 1. Colisão de porta que se disfarça de erro de credencial

`infra/docker/docker-compose.dev.yml` publica `"5432:5432"`, `"6379:6379"`,
`"5672:5672"`, `"15672:15672"` — todos em `0.0.0.0`.

Na máquina do fundador **já existe um Postgres nativo** escutando em `0.0.0.0:5432`
e `[::]:5432` (`postgres.exe`, PID 7700). O `docker compose up` reportou
`postgres  Up (healthy)` e `docker port` listou `5432/tcp -> 0.0.0.0:5432` —
**sem erro de bind**. Mas toda conexão do host para `localhost:5432` chega no
Postgres nativo, que não tem o usuário `hm`:

```
pnpm --filter @hm/db migrate
→ code: '28P01', severity: 'FATAL', routine: 'auth_failed'
```

Isto custa horas: o sintoma diz "senha errada", a causa é "porta de outro processo".
Confirmado que o container está sadio por dentro:
`docker exec tagix-dev-postgres-1 psql -U hm -d highermind -c "select current_user"`
→ `hm`. Com o mesmo container republicado em `55432`, as 67 migrations aplicaram
limpas.

Note que o compose **já resolveu esse problema para o WAHA** (`"3100:3000"`, com
comentário explicando) — a lição só não foi aplicada ao resto.

### 2. Bind em todas as interfaces

`"5432:5432"` expõe Postgres, Redis e RabbitMQ para a **rede local** (Wi-Fi de
café, rede de coworking). Redis sem senha e RabbitMQ com `hm/hm` são credenciais de
brinquedo — o que é aceitável em `127.0.0.1`, não em `0.0.0.0`.

### 3. WAHA sem pin de versão e sem autenticação

`image: devlikeapro/waha:latest` — tag móvel, build não reprodutível, atualização
silenciosa de um componente que fala com WhatsApp. E nenhuma variável de API key:
qualquer processo que alcance a porta 3100 controla as sessões de WhatsApp.

### 4. Drift de versão entre dev e prod

`prom/prometheus:v3.1.0` no dev vs `prom/prometheus:v2.53.1` no prod — major
diferente. Regras de alerta validadas no dev podem não valer no prod.

## Escopo (faz)

- Prefixar todas as publicações de porta com `127.0.0.1:` no compose de dev.
- Mover Postgres/Redis/RabbitMQ para portas de host que não colidam com instalação
  nativa (sugestão: `55432`, `56379`, `55672`, `clara15672`) **ou** manter as
  canônicas e documentar override — mas a escolha precisa ser explícita e
  refletida em `.env.example` e no runbook.
- Pinar `devlikeapro/waha` numa versão concreta e configurar API key via env.
- Alinhar a versão do Prometheus entre dev e prod (subir o prod ou descer o dev —
  decidir e justificar; se subir o prod, revalidar `infra/prometheus/alerts.yml`).
- Documentar o mapa de portas em `docs/runbooks/dev-environment-windows.md`,
  incluindo o sintoma `28P01` → "porta 5432 tomada por Postgres nativo".

## Escopo (não faz)

- `docker-compose.prod.yml` (lá as portas já são internas e corretas), exceto a
  linha da imagem do Prometheus se a decisão for subir o prod.
- Secrets do Swarm → **F57-S08**.

## Arquivos permitidos

- `infra/docker/docker-compose.dev.yml`
- `.env.example`
- `docs/runbooks/dev-environment-windows.md`
- `infra/docker/docker-compose.prod.yml` (só a tag do Prometheus)
- `infra/prometheus/alerts.yml`

## Arquivos proibidos

- `apps/**`, `packages/**`

## Definition of Done

- [ ] Nenhuma porta do compose de dev publicada em `0.0.0.0` (validar com
      `docker compose ... ps` + `Get-NetTCPConnection`).
- [ ] `docker compose -f infra/docker/docker-compose.dev.yml up -d` seguido de
      `pnpm --filter @hm/db migrate` funciona em máquina com Postgres nativo ativo.
- [ ] `devlikeapro/waha` pinado; API key exigida.
- [ ] Prometheus na mesma major em dev e prod.
- [ ] Mapa de portas + sintoma `28P01` documentados no runbook.

## Validação

```bash
docker compose -f infra/docker/docker-compose.dev.yml config
```

## Notas

- Se as portas mudarem, `.env.example` (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`) e o
  bloco `env:` do CI precisam acompanhar — mas **cuidado**: no CI os serviços são
  `services:` do runner, com portas próprias. Não unifique o que não é a mesma coisa.
