---
id: F57-S13
title: README e AUDITORIA_TECNICA refletem o estado real do repo
phase: F57
status: available
priority: low
estimated_size: S
depends_on: []
blocks: []
agent_id: orchestrator
source_docs:
  - README.md
  - AUDITORIA_TECNICA.md
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S13 — Os dois documentos mais lidos do repo estão desatualizados

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). Documento errado na raiz
> é pior que documento ausente: agente e humano confiam nele.

## Objetivo

Fazer os dois arquivos que qualquer recém-chegado (ou agente) lê primeiro dizerem a
verdade sobre o repositório.

## Contexto / causa raiz (verificada)

### 1. `README.md` descreve um repo que não existe mais

`README.md:10`:

> *"**Apenas documentação.** Este commit inicial sobe a especificação completa […]
> O código (`apps/`, `packages/`, `infra/`) será materializado pelo `/hm-init` na
> fase seguinte."*

E `README.md:41` lista `apps/`, `packages/` e `infra/` sob o rótulo **"(em breve)"**.

O repo tem hoje **1.512 arquivos TypeScript, 218 arquivos de teste, 67 migrations,
407 slots entregues e produção rodando** em `app.leadium.com.br`. A seção "Próximos
passos" ainda instrui *"Rodar `/hm-init` … → materializa estrutura"* — passo cumprido
56 fases atrás.

Também está defasado: a tabela de stack diz `Deploy: Docker Compose na VPS, Nginx via
aaPanel`, quando o real é **Docker Swarm + Traefik** (`docker-compose.prod.yml`), e
diz `Storage: Cloudflare R2` quando o default em prod é `STORAGE_DRIVER=local`.

### 2. `AUDITORIA_TECNICA.md` (65 KB) não diz o que já foi resolvido

O documento é excelente e foi claramente o insumo da fase F56 — mas está congelado em
`2026-07-09`, HEAD `933a145b`. O HEAD atual é `53b6364e`, e **a maior parte do tier
crítico foi fechada**. Verificado nesta auditoria:

| Achado | Estado hoje | Evidência |
|---|---|---|
| P0 — `model_supports_vision` inexistente | **resolvido** | `apps/agent-runtime/app/nodes/load_context.py:73` deriva de `vision_model IS NOT NULL` |
| SEC-02 — `AUTH_PROVIDER=mock` sem guarda | **resolvido** | `apps/api/src/auth/provider.ts` — `throw` fail-fast em produção |
| SEC-03 — sem `FORCE ROW LEVEL SECURITY` | **resolvido** | `packages/db/drizzle/0062_f56_force_rls.sql` — `DO` loop em toda tabela com RLS |
| SEC-04 — `agent_templates` sem RLS | **resolvido** | `0062_f56_force_rls.sql:29-35` — enable + policies read/write |
| SEC-01 — SSRF em webhook outbound | **resolvido** | `packages/shared/src/net/ssrf-guard.ts` + `ssrf-guard.test.ts` |
| "sem healthcheck nos containers de app" | **resolvido** | healthcheck real nos 4 Dockerfiles + no `docker-compose.prod.yml` |
| "deploy com downtime, sem rollback" | **resolvido** | `x-update-policy` com `order: start-first` + verificação de convergência de sha |

Um agente que leia o §1 hoje conclui que o produto está no estado de julho e
re-trabalha o que já foi feito — ou pior, propõe uma correção que conflita com a
solução adotada.

## Escopo (faz)

- Reescrever `README.md`: estado real, árvore real, stack real (Swarm + Traefik),
  comandos que funcionam hoje, ponteiro para `tasks/STATUS.md` e `docs/INDEX.md`.
  Remover a seção "(em breve)" e o passo `/hm-init` de "Próximos passos".
- `AUDITORIA_TECNICA.md`: cabeçalho de status no topo (data, sha auditado, sha atual,
  "superseded em parte por F56") e marcação por achado — `RESOLVIDO em <slot>` /
  `ABERTO` / `PARCIAL`. Não apagar nada: o valor histórico do documento é real.
- Mover para `docs/audits/` se a convenção do repo for essa (já existe o diretório) e
  deixar ponteiro na raiz.
- Conferir `docs/INDEX.md`: se referencia a auditoria, refletir o novo status.

## Escopo (não faz)

- Corrigir os achados ainda abertos da auditoria (§4 tem os épicos; viram slots via
  `/hm-tasks`).
- `CLAUDE.md` do projeto (está preciso e atual).

## Arquivos permitidos

- `README.md`
- `AUDITORIA_TECNICA.md`
- `docs/audits/**`
- `docs/INDEX.md`

## Arquivos proibidos

- `CLAUDE.md`
- `tasks/**`
- `apps/**`, `packages/**`

## Definition of Done

- [ ] `README.md` sem nenhuma afirmação falsa; um engenheiro sênior entende o projeto
      em 10 minutos e roda o dev sem se perder.
- [ ] Stack no README casa com `docker-compose.prod.yml` (Swarm + Traefik) e com
      `STORAGE_DRIVER` real.
- [ ] Todo achado da `AUDITORIA_TECNICA.md` marcado `RESOLVIDO`/`ABERTO`/`PARCIAL`,
      com sha ou slot na evidência.
- [ ] Cabeçalho de status no topo da auditoria, com as duas datas e os dois shas.

## Validação

```bash
pnpm format:check
```

## Notas

- Ao marcar os achados: **verificar no código**, não deduzir do changelog. A tabela
  acima já traz 7 conferidos com arquivo e linha; os demais (Campanhas, reconexão
  AMQP, DLQ em todas as filas, particionamento do Postgres, bifurcação do DS) exigem
  a mesma checagem antes de receber rótulo.
