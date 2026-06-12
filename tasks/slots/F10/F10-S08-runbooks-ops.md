---
id: F10-S08
title: Runbooks operacionais — postgres-down, restore-backup, rotate-key, waba-banned
phase: F10
status: review
priority: medium
estimated_size: S
depends_on: []
agent_id: general-purpose
source_docs:
  - docs/ROADMAP.md#F10-S09
  - docs/INFRASTRUCTURE.md
claimed_at: 2026-06-12T13:54:47Z
completed_at: 2026-06-12T13:55:02Z

---
# F10-S08 — Runbooks operacionais

> **source_docs:** `docs/ROADMAP.md` F10-S09; `docs/INFRASTRUCTURE.md`
> **blocks:** —

## Objetivo

Quatro runbooks de incidente acionáveis para produção (VPS Ubuntu/Linux), com passos concretos, comandos **bash** (prod é Linux), critérios de detecção, mitigação e verificação de recuperação.

## Contexto

Produção é Linux; só esse contexto usa bash. Os runbooks fecham o gap operacional antes de clientes. Pasta `docs/runbooks/` já existe com outros arquivos — este slot só adiciona os 4 novos.

## Escopo (faz)

- `docs/runbooks/incident-postgres-down.md`: detecção, failover/restart, checagem de RLS/conexões, verificação.
- `docs/runbooks/restore-from-backup.md`: PITR/restore de dump, validação de integridade, smoke test pós-restore.
- `docs/runbooks/rotate-encryption-key.md`: rotação da chave de criptografia de secrets (`secret_enc`) sem downtime, re-encrypt em lote, rollback.
- `docs/runbooks/meta-waba-banned.md`: resposta a banimento WABA (Meta), comunicação, fallback de canal, reativação.

## Fora de escopo

- Editar runbooks existentes (`dev-environment-windows.md`, `multi-agent-dev.md`, etc.).
- Automação/scripts (runbooks são prosa acionável; scripts são follow-up).

## Arquivos permitidos

- `docs/runbooks/incident-postgres-down.md`
- `docs/runbooks/restore-from-backup.md`
- `docs/runbooks/rotate-encryption-key.md`
- `docs/runbooks/meta-waba-banned.md`

## Arquivos proibidos

- Qualquer outro arquivo em `docs/runbooks/**` que já exista.

## Definition of Done

- [ ] 4 runbooks com: sintomas/detecção, passos numerados (comandos bash reais), critério de "resolvido", e rollback quando aplicável.
- [ ] Coerentes com a infra descrita em `docs/INFRASTRUCTURE.md` (Postgres self-hosted + RLS, storage, WAHA).
- [ ] Sem comando destrutivo sem confirmação/backup prévio explícito no passo.

## Validação

```bash
test -f docs/runbooks/incident-postgres-down.md
test -f docs/runbooks/restore-from-backup.md
test -f docs/runbooks/rotate-encryption-key.md
test -f docs/runbooks/meta-waba-banned.md
```

## Notas

- Executor: **general-purpose** (slot de docs, sem código).
- Comandos são para Linux/prod (bash), nunca PowerShell — é o único contexto bash do projeto.
