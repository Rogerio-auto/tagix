---
id: F70-S22
title: deploy.sh migra antes de subir o código novo
phase: F70
status: in-progress
priority: critical
estimated_size: S
depends_on: [F70-S20]
blocks: []
source_docs:
  - scripts/deploy.sh
  - docs/runbooks/deploy-production.md
agent_id: backend-engineer
claimed_at: 2026-09-25T12:33:39Z

---
# F70-S22 — deploy.sh migra antes de subir o código novo

## Objetivo

Nenhum deploy rodar código novo contra o schema velho. Achado HIGH-1 da segunda auditoria pré-deploy (25/09).

## Contexto

`scripts/deploy.sh` faz `docker stack deploy` no passo 4 (linha ~84) e só migra no passo 6 (linhas ~139-151), depois do `pg_dump`. Com a F70, a api e os workers novos sobem com `start-first`, passam no healthcheck (que não olha o schema) e quebram até a migração terminar:
- toda gravação com `enqueueOutbox` falha, porque a tabela `outbox` ainda não existe;
- os `select()` de `conversations` falham nas colunas da 0088;
- o gate do worker de agentes quebra.

Se a migração falhar (pré-voo da 0085/0086, `lock_timeout`), o código novo fica rodando contra o schema velho sem prazo. As migrações da F70 são aditivas, então o código velho convive com o schema novo: migrar primeiro é seguro.

## Escopo

### files_allowed

- `scripts/deploy.sh`
- `scripts/tests/**`
- `docs/runbooks/deploy-production.md`
- `docs/runbooks/rollback-deploy.md`

## Escopo (faz)

- Nova ordem: pré-checagens → código → build das imagens com a tag do sha → Postgres saudável → backup (fail-closed, como hoje) → **migrações com a imagem nova, num container efêmero na rede interna** → `docker stack deploy` → espera a convergência → verificação.
- **Primeira instalação** (stack ainda não existe e não há Postgres rodando): subir só o Postgres do stack, esperar ficar saudável, migrar, e então subir o resto. Documentar.
- Migração falhou → aborta **antes** do stack deploy: nada do código novo sobe, e a mensagem diz o que fazer.
- Manter o re-exec da própria versão (§1.1) e a retenção de backups.
- A regra vira permanente no runbook: migração aditiva primeiro; migração destrutiva exige o padrão expand/contract (documentar).

## Definition of Done

- [ ] teste de fumaça do script: `bash -n` e ShellCheck limpo (se disponível)
- [ ] teste que prova a ordem: script executado com `docker`/`git` falsos no PATH registra a sequência de chamadas; `migrate` vem antes de `stack deploy`; falha no migrate → nenhum `stack deploy`
- [ ] runbook atualizado (ordem, primeira instalação, expand/contract)

## Validação

```bash
bash -n scripts/deploy.sh
python -m pytest -q scripts/tests
```
