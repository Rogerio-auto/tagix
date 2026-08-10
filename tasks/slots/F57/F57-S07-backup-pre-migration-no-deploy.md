---
id: F57-S07
title: Backup pré-migration no deploy.sh — dados são sagrados
phase: F57
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: db-engineer
source_docs:
  - scripts/deploy.sh
  - docs/runbooks/restore-from-backup.md
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S07 — Deploy aplica 67 migrations em produção sem snapshot prévio

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). Padrão Higher Mind:
> *"Dados são sagrados — nunca perder dados"*.

## Objetivo

Garantir que exista um ponto de restauração imediatamente antes de qualquer
migration tocar o banco de produção.

## Contexto / causa raiz (verificada)

`scripts/deploy.sh` faz, na ordem: `git reset --hard` → build das imagens →
`docker stack deploy` → espera Postgres → **roda migrations** (`§6`, linhas 77-91,
com 6 tentativas) → verifica convergência de sha.

Não há **nenhuma** etapa de backup. Uma migration destrutiva (`DROP COLUMN`,
`ALTER TYPE`, `UPDATE` de backfill errado) é aplicada em produção multi-tenant sem
snapshot. O runbook `docs/runbooks/restore-from-backup.md` existe e descreve como
restaurar — mas o deploy não **produz** o artefato que o runbook pressupõe, e não
encontrei nenhum backup automatizado no repo (`grep -rl 'pg_dump'` só acerta docs e
slots, nunca um script executável).

O resto do script é notavelmente bom (tag por sha, `start-first`, verificação
explícita de convergência com falha alta). Esta é a lacuna que sobrou, e é a de
maior consequência: as outras falham o deploy, esta perde dados de cliente pagante.

## Escopo (faz)

- Etapa nova em `deploy.sh`, **antes** do `§6 migrations`: `pg_dump` (custom format,
  comprimido) do banco de produção para volume/host path, nomeado por sha + timestamp.
- **Fail-closed:** se o dump falhar, o deploy aborta antes de migrar.
- Retenção: manter as N últimas (sugestão 10) + poda das antigas.
- Registrar no output o caminho do dump e o comando de restore correspondente, para
  que o operador tenha a saída pronta durante um incidente.
- Atualizar `docs/runbooks/restore-from-backup.md` e `rollback-deploy.md` apontando
  para o artefato que o deploy agora garante.

## Escopo (não faz)

- Backup **contínuo** / PITR (WAL archiving, `wal-g`, `pgbackrest`) e off-site. É a
  resposta certa para o médio prazo e merece slot próprio — este slot fecha o buraco
  agudo do deploy.
- Secrets do Swarm → **F57-S08**.
- Build em registry → **F57-S09**.

## Arquivos permitidos

- `scripts/deploy.sh`
- `scripts/deploy.ps1`
- `docs/runbooks/restore-from-backup.md`
- `docs/runbooks/rollback-deploy.md`
- `docs/runbooks/deploy-production.md`
- `infra/docker/docker-compose.prod.yml` (só se precisar de volume novo p/ dumps)

## Arquivos proibidos

- `packages/db/drizzle/**`
- `packages/db/src/migrate.ts`

## Definition of Done

- [ ] `deploy.sh` produz dump verificável antes de migrar; deploy aborta se o dump
      falhar (testar injetando falha).
- [ ] Retenção implementada e testada (N+1 dumps → o mais antigo é podado).
- [ ] Restore testado de verdade a partir de um dump gerado pelo script, num banco
      descartável — não só documentado.
- [ ] Runbooks de restore e rollback referenciam o caminho e o nome real do artefato.

## Validação

```bash
bash -n scripts/deploy.sh
```

## Notas

- Um dump lógico de banco grande pode dominar a janela de deploy. Se o tempo doer,
  a resposta é PITR (slot futuro), **não** pular o dump.
- Enquanto este slot não fechar: `pg_dump` manual antes de todo deploy que traga
  migration nova. É a regra provisória, e vale a partir de hoje.
