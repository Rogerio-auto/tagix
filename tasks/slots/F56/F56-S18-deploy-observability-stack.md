---
id: F56-S18
title: Deploy hardening + stack de observabilidade (healthcheck, rollback, Prometheus)
phase: F56
status: available
priority: high
estimated_size: M
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S18 — Deploy sem downtime + observabilidade coletada (QA-03/04/07)

> **Origem:** AUDITORIA_TECNICA.md §3.10. Containers de app sem healthcheck; deploy stop-first sem rollback (downtime a cada deploy); métricas Prometheus emitidas mas nunca coletadas (sem scrape/alerta).

## Objetivo

Deploy zero-downtime com rollback automático e uma stack de observabilidade que efetivamente coleta e alerta.

## Contexto / causa raiz (verificada)

`infra/docker/docker-compose.prod.yml` — só pg/redis/rabbitmq têm healthcheck; serviços de app `replicas:1` sem `update_config`/`rollback_config`; sem Prometheus/Grafana/Alertmanager.

## Escopo (faz)

- `healthcheck` em api/workers/web/agent-runtime (bate `/health` / `/healthz` / TCP).
- `deploy.update_config: {order: start-first, failure_action: rollback, monitor: 30s}` + `rollback_config` em api/web.
- Serviço Prometheus + Alertmanager no stack; scrape de api/workers; alertas mínimos: 5xx rate, p95 latência, fila RabbitMQ ready, worker up.

## Escopo (não faz)

- Código de healthcheck do app (F56-S17 workers `/healthz`, F56-S21 api RabbitMQ). Sentry (F56-S19).

## Arquivos permitidos

- `infra/docker/**`
- `infra/prometheus/**`

## Arquivos proibidos

- `scripts/deploy.sh` · `scripts/deploy.ps1` (não alterar o fluxo de deploy aqui; só a topologia)

## Definition of Done

- [ ] Todos os serviços de app têm healthcheck e `start-first` + rollback.
- [ ] Prometheus faz scrape de api/workers; Alertmanager com ≥4 alertas.
- [ ] `docker compose -f infra/docker/docker-compose.prod.yml config` valida.

## Validação

```bash
docker compose -f infra/docker/docker-compose.prod.yml config >/dev/null
```

## Notas

- Rodar em produção é Linux/Swarm — o `config` local só valida a sintaxe. O healthcheck de app depende de F56-S17/S21 exporem os endpoints; referenciar `/healthz` e `/health` corretos.
