---
id: F70-S02
title: Backup e limpeza da conta do Rogério
phase: F70
status: blocked
priority: high
estimated_size: S
depends_on: [F70-S01]
blocks: [F70-S03]
source_docs:
  - rogerio-os/tasks/central-operacao/CO-03-backup-e-limpeza-da-conta-do-rogerio-no-leadium.md
---
# F70-S02 — Backup e limpeza da conta do Rogério

> Espelho do **CO-03** da Central de Operação (`rogerio-os/tasks/central-operacao/`).

## Objetivo

O workspace do Rogério ficar limpo para a operação da Arcada, sem perder nada por acidente.

## Contexto

Pedido de 24/09: a caixa que existe hoje e os contatos cadastrados nela não serão mais usados e podem ser excluídos. Produção tinha 200 contatos e 2365 mensagens em 09/09.

## Escopo

### files_allowed

- `scripts/cleanup-workspace-inbox.*`

## Escopo (faz)

- `pg_dump` do banco (como o `deploy.sh` já faz) e cópia para fora da VPS.
- Script de limpeza **idempotente, com `--dry-run`**: exporta em CSV os canais, conversas e contatos que seriam excluídos, só daquele workspace.
- Com a confirmação do Rogério: desativar o canal antigo na Meta; excluir canal, conversas e contatos, respeitando RLS e cascatas.
- Registrar a exclusão (data, contagens, local do backup).

## Fora de escopo

- Qualquer outro workspace (clientes do Leadium).

## Passos do Rogério 🧑

- Confirmar a lista exata do que será excluído, na hora da execução.
- Guardar o arquivo de backup fora da VPS.

## Definition of Done

- [ ] `--dry-run` revisado pelo Rogério
- [ ] backup restaurável testado num banco local
- [ ] exclusão executada e contagens registradas em `tasks/COMMS.md`
