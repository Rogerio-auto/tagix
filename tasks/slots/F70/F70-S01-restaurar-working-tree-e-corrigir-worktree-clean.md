---
id: F70-S01
title: Restaurar o working tree e corrigir o worktree-clean que atravessa junctions
phase: F70
status: review
priority: critical
estimated_size: XS
depends_on: []
blocks: [F70-S02]
source_docs:
  - rogerio-os/tasks/central-operacao/CO-02-conferir-e-restaurar-o-working-tree-do-leadium.md
agent_id: backend-engineer
claimed_at: 2026-09-24T22:29:25Z
completed_at: 2026-09-24T22:29:47Z

---
# F70-S01 — Restaurar o working tree e corrigir o worktree-clean que atravessa junctions

> Espelho do **CO-02** da Central de Operação (`rogerio-os/tasks/central-operacao/`).

## Objetivo

O monorepo voltar a buildar localmente e o `slot.py worktree-clean` nunca mais apagar o checkout principal.

## Contexto

Em 22/09, 16:58, depois do merge da F58-S05, `python scripts/slot.py worktree-clean` removeu 7 worktrees. O `slot.py validate` cria junctions nos worktrees apontando para os `node_modules` do main, e dentro deles há junctions para `packages/*`. O `git worktree remove --force` do Git para Windows seguiu as junctions e esvaziou `packages/*` (484 arquivos rastreados) e `apps/*/node_modules` do checkout principal. Produção não foi afetada (o deploy sai do git). Registro completo em `tasks/COMMS.md`.

## Escopo

### files_allowed

- `scripts/slot.py`
- `scripts/tests/**`
- `tasks/COMMS.md`

## Escopo (faz)

- `git restore packages` e `pnpm install` (recria os `node_modules`), com o ok do Rogério.
- Typecheck provando que builda.
- `cmd_worktree_clean` remove as junctions de `node_modules` do worktree, sem seguir o alvo, antes de `git worktree remove`.
- Teste num repo descartável provando que o main fica intacto, com um teste de controle mostrando que o Git ainda atravessa a junction sem a correção.
- Incidente em `tasks/COMMS.md`.

## Fora de escopo

- Mudar código de produto.
- A mesma correção no Elemento e no projeto28 (tarefa separada).

## Definition of Done

- [x] `git status` limpo em `packages/`
- [x] `pnpm -r typecheck` passando (14 de 14)
- [x] `scripts/tests/test_worktree_clean.py` passando (3 de 3)
- [x] incidente registrado em `tasks/COMMS.md`

## Validação

```bash
python -m pytest -q scripts/tests/test_worktree_clean.py
```
