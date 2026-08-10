---
id: F57-S05
title: .dockerignore do contexto landing/ + nginx non-root nas imagens estáticas
phase: F57
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - landing/Dockerfile
  - infra/docker/landing/Dockerfile
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S05 — Contexto de build da landing sem `.dockerignore` e nginx como root

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). O padrão Higher Mind é
> categórico: *"Criar `.dockerignore` no root de CADA serviço que tem Dockerfile"*
> e *"Rodar como usuário não-root (`USER appuser`, nunca root)"*.

## Objetivo

Fechar as duas violações de fundação Docker que sobraram.

## Contexto / causa raiz (verificada)

### 1. `landing/` builda sem `.dockerignore`

O repo tem **6 Dockerfiles** e apenas **2 `.dockerignore`** (`./.dockerignore` e
`./apps/agent-runtime/.dockerignore`).

O `.dockerignore` da raiz é excelente — mas cobre só builds cujo **contexto é a
raiz**. O serviço `landing` do `docker-compose.prod.yml:355` declara
`context: ../../landing`, e `landing/Dockerfile` faz `COPY . .`. Nesse contexto o
`.dockerignore` da raiz **não se aplica**. Consequência: `landing/node_modules`
local, `landing/.env` (se existir — o `landing/.gitignore` o ignora no git, o que
torna a presença local *provável*) e `landing/dist` entram no contexto e no stage
de build.

O segredo não sobrevive na imagem final (o stage final é `nginx` + `COPY --from`),
mas fica na camada intermediária e no cache do builder — visível em
`docker history` / `docker save` do stage de build, e sujeito a push acidental.

### 2. Ambas as imagens nginx rodam como root

Nem `landing/Dockerfile` nem `infra/docker/landing/Dockerfile` têm diretiva `USER`.
A imagem `nginx:1.27-alpine` sobe o processo master como **root** (só os workers
descem para `nginx`). O serviço `landing` está na rede `network_public`, atrás do
Traefik — é a superfície mais exposta do stack e a de menor valor. Não há razão para
ter root ali.

## Escopo (faz)

- Criar `landing/.dockerignore` (mesmos princípios do da raiz: `node_modules`,
  `dist`, `.env*` com exceção de `.env.example`, `.git`, `*.md`, editores).
- Migrar as duas imagens nginx para `nginxinc/nginx-unprivileged:1.27-alpine`
  (roda como UID 101, escuta em 8080) **ou** adicionar `USER nginx` com os ajustes
  de permissão de `/var/cache/nginx` e `/var/run`. Preferir a imagem unprivileged —
  é a opção mantida upstream para exatamente este caso.
- Ajustar `nginx.conf` / `default.conf` para a porta não privilegiada e o label
  `traefik.http.services.leadium_landing.loadbalancer.server.port` no
  `docker-compose.prod.yml` para casar.
- Ajustar o `HEALTHCHECK` (o `wget` bate em `/` na porta nova).

## Escopo (não faz)

- Os Dockerfiles de `api`/`workers` (contexto = raiz, cobertos; a dívida de
  imagem gorda deles é de outro slot).
- Traefik / TLS.

## Arquivos permitidos

- `landing/.dockerignore`
- `landing/Dockerfile`
- `landing/nginx.conf`
- `infra/docker/landing/Dockerfile`
- `infra/docker/landing/default.conf`
- `infra/docker/docker-compose.prod.yml`

## Arquivos proibidos

- `apps/*/Dockerfile`
- `.dockerignore` (o da raiz está correto — não mexer)

## Definition of Done

- [ ] `landing/.dockerignore` existe e `docker build` da landing não copia
      `node_modules`/`dist`/`.env` (verificar com
      `docker build --target build -t t . && docker run --rm t ls -a`).
- [ ] `docker inspect --format '{{.Config.User}}'` das duas imagens nginx retorna
      usuário não-root.
- [ ] `docker compose -f infra/docker/docker-compose.prod.yml config` válido; label
      de porta do Traefik casa com a porta do nginx.
- [ ] Healthcheck das duas imagens continua passando.

## Validação

```bash
docker compose -f infra/docker/docker-compose.prod.yml config
docker build -f landing/Dockerfile -t leadium-landing:audit landing
```

## Notas

- `docker-compose.prod.yml` só constrói `landing/Dockerfile`; o
  `infra/docker/landing/Dockerfile` parece ser o predecessor estático ("substituível
  pela landing real depois"). Se estiver morto, **deletar** é melhor do que endurecer
  — mas confirme antes: Dockerfile órfão é armadilha para o próximo agente.
