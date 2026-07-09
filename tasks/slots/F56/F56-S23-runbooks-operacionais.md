---
id: F56-S23
title: Runbooks — fila estourada, worker crash-loop, rollback
phase: F56
status: available
priority: medium
estimated_size: XS
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S23 — Runbooks dos incidentes mais prováveis (QA-16)

> **Origem:** AUDITORIA_TECNICA.md §3.10. Há runbooks bons, mas faltam os cenários mais frequentes do dia-a-dia pago: RabbitMQ down/backlog, worker crash-loop, rollback de deploy.

## Objetivo

Documentar procedimento acionável para os três incidentes operacionais mais prováveis.

## Escopo (faz)

- `docs/runbooks/incident-rabbitmq-backlog.md` — fila estourada/DLQ cheia: diagnóstico + replay do CLI de DLQ + escala.
- `docs/runbooks/incident-worker-crash-loop.md` — worker morto/reiniciando: logs, healthcheck, redeploy.
- `docs/runbooks/rollback-deploy.md` — `docker service rollback` / redeploy da tag anterior (ligado ao single-service deploy).

## Escopo (não faz)

- Código (só docs).

## Arquivos permitidos

- `docs/runbooks/**`

## Arquivos proibidos

- (nenhum código)

## Definition of Done

- [ ] Três runbooks criados, cada um com sintomas → diagnóstico → passos → verificação.
- [ ] Referenciam comandos reais (CLI de DLQ, `docker service`, `deploy.sh`).

## Validação

```bash
ls docs/runbooks/incident-rabbitmq-backlog.md docs/runbooks/incident-worker-crash-loop.md docs/runbooks/rollback-deploy.md
```

## Notas

- Reusar o padrão dos runbooks existentes (`incident-postgres-down.md`, `restore-from-backup.md`).
