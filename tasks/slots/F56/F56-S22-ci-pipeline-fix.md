---
id: F56-S22
title: CI — corrigir deploy errado + Python + RabbitMQ + e2e
phase: F56
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S22 — Pipeline de CI correto (QA-08/QA-13/QA-14/QA-02)

> **Origem:** AUDITORIA_TECNICA.md §3.10. O job `deploy` do CI aponta para `/opt/tagix` com `docker compose up` (prod real é `/opt/leadium`/Swarm) — landmine. Python (agent-runtime) e RabbitMQ estão fora do CI; e2e (16 specs) nunca roda.

## Objetivo

Deixar o CI seguro e representativo: sem deploy errado, com Python, RabbitMQ e e2e mockado rodando.

## Contexto / causa raiz (verificada)

`.github/workflows/ci.yml:79-88` (deploy para caminho/mecanismo errados); `services` só pg+redis; sem passo `uv`/`pytest`; Playwright no script `e2e` que ninguém invoca.

## Escopo (faz)

- Substituir/remover o job de deploy (ou apontar para `bash /opt/leadium/scripts/deploy.sh main` via SSH, gated por secrets).
- Job paralelo Python: `uv sync && pytest` no agent-runtime.
- Adicionar service `rabbitmq` + smoke de publish/consume.
- Job e2e dedicado com `webServer` do Playwright rodando os specs mockados.

## Escopo (não faz)

- Gate de cobertura (opcional, follow-up). Deploy real.

## Arquivos permitidos

- `.github/workflows/**`

## Arquivos proibidos

- `scripts/deploy.sh` · `scripts/deploy.ps1`

## Definition of Done

- [ ] Job de deploy não roda mais `docker compose up` em caminho errado.
- [ ] CI roda pytest do agent-runtime e sobe RabbitMQ.
- [ ] Job e2e executa os specs mockados.
- [ ] O workflow é válido (lint de YAML / `act --list` ou revisão).

## Validação

```bash
python -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]; print('yaml ok')"
```

## Notas

- e2e local não hidrata neste host (memória do projeto) — os specs mockados (`fixtures/api-mock.ts`) independem de infra e são o alvo do job.
