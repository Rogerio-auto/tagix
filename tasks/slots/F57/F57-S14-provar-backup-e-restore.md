---
id: F57-S14
title: Provar o backup — teste de retenção e restore de verdade
phase: F57
status: available
priority: high
estimated_size: S
depends_on: [F57-S07]
blocks: []
agent_id: backend-engineer

---
# F57-S14 — Provar o backup — teste de retenção e restore de verdade

## Objetivo

Transformar o backup pré-migration de "existe" em "funciona": retenção testada e um restore real a partir de um dump gerado pelo deploy.

## Contexto

Absorve dois itens da F57-S07 que foram marcados como concluídos sem evidência (auditoria de 2026-09-14): a retenção está implementada (`BACKUP_KEEP` em `scripts/deploy.sh`) mas não tem teste, e não há registro de restore executado a partir de um dump do script. Produção tem 10 dumps em `/opt/leadium/backups`. Backup que nunca foi restaurado é hipótese.

## Escopo

### files_allowed

- `scripts/deploy.sh`
- `scripts/backup-*.sh`
- `scripts/*.test.sh`
- `docs/runbooks/restore-from-backup.md`
- `docs/audits/**`

### files_forbidden

- `apps/**`
- `packages/**`

## Escopo (faz)

- Teste da poda: N+1 dumps geram N, e o removido é o mais antigo.
- Restore de um dump real de produção num banco descartável, com contagem das tabelas principais antes e depois.
- Registro datado em `docs/audits/` com o tempo que o restore levou.

## Fora de escopo

- Backup contínuo com PITR (merece slot próprio).

## Definition of Done

- [ ] Teste de retenção automatizado passa.
- [ ] Restore executado a partir de dump do script, com contagens conferidas.
- [ ] Registro do restore em `docs/audits/` com data e duração.
- [ ] Runbook atualizado com o que o restore real ensinou.

## Validação

```bash
bash scripts/backup-retention.test.sh
```

## Notas

- A régua: sabemos quanto tempo leva voltar, porque já voltamos.
