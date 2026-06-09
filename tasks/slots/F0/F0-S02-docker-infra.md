---
id: F0-S02
title: Docker Compose dev — Postgres pgvector + Redis + RabbitMQ + WAHA
phase: F0
status: done
priority: high
estimated_size: S
depends_on: [F0-S01]
---

# F0-S02 — Docker Compose dev local

> **source_docs:** `docs/INFRASTRUCTURE.md`; `docs/runbooks/dev-environment-windows.md`

## Objetivo

Stack de infra local subindo com um comando, com health checks e volumes nomeados.

## Escopo (faz)

- `infra/docker/docker-compose.dev.yml` — postgres (pgvector/pgvector:pg16), redis 7, rabbitmq 3.13-management, waha; health checks; volumes nomeados; secrets via `${VAR}`.

## Arquivos permitidos

- `infra/docker/**`

## Definition of Done

- [x] `docker compose -f infra/docker/docker-compose.dev.yml up -d` levanta tudo.
- [x] Todos `healthy`; pgvector disponível (extensão `vector`).

## Validação

```bash
docker compose -f infra/docker/docker-compose.dev.yml config
```

## Notas

Concluído junto da fundação. Porta 3000 (WAHA) conflita com o Next dev — parar WAHA ou remapear ao subir o web.
