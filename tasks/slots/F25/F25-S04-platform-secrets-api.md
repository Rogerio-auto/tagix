---
id: F25-S04
title: Platform secrets rotation API — rotaciona OpenRouter/Meta/encryption keys + auditoria
phase: F25
status: in-progress
priority: high
estimated_size: M
depends_on: [F25-S01]
agent_id: backend-engineer
source_docs:
  - docs/ROADMAP.md#F2.5
  - docs/INFRASTRUCTURE.md
claimed_at: 2026-06-13T01:26:41Z

---
# F25-S04 — Platform secrets rotation API

> **source_docs:** `docs/ROADMAP.md` F2.5-S04; `docs/INFRASTRUCTURE.md` §10
> **blocks:** F25-S08

## Objetivo

API de plataforma para gerenciar e **rotacionar** os `platform_secrets` (OpenRouter API key, Meta App Secret/App ID/webhook verify token, etc.): listar chaves (metadados, **nunca o valor em claro**), setar/rotacionar um valor (re-cifra AES-256-GCM, incrementa `key_version`), com auditoria obrigatória de cada rotação em `audit_logs`. Gated por `requirePlatformAdmin`.

## Contexto

`platform_secrets` (key/value_enc/key_version, sem workspace) já existe — cifrado, lido só no boot da API. A F10 entregou o runbook `rotate-encryption-key.md` (rotação da chave mestra); este slot é a **rotação dos secrets individuais** via painel. Sensível: nunca expor valor; sempre auditar.

## Escopo (faz)

- `apps/api/src/routes/platform/secrets.ts` (novo): `GET /platform/secrets` (lista keys + key_version + updated_at, SEM valor), `PUT /platform/secrets/:key` (`{ value }` → cifra, upsert, key_version++), com `requirePlatformAdmin` + Zod + audit.
- `apps/api/src/services/platform/secret-rotation.ts` (novo): cifra/decifra (reusa crypto de `@hm/db`), validação de key conhecida, escrita auditada.
- Teste (rotação não vaza valor; key_version incrementa; audit gravado).

## Fora de escopo

- Rotação da chave-mestra de criptografia (runbook F10 / F25-S09). Guard (S01). Frontend (S08).

## Arquivos permitidos

- `apps/api/src/routes/platform/secrets.ts`
- `apps/api/src/services/platform/secret-rotation.ts`
- `apps/api/src/routes/platform/secrets.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts`, outros `routes/platform/*` (S02/S03/S05)

## Definition of Done

- [ ] `GET` lista metadados sem valor em claro; `PUT` cifra + key_version++ + audit; valor nunca aparece em log/resposta.
- [ ] Rotação reusa o crypto AES-256-GCM de `@hm/db` (mesmo de channel_secrets); key desconhecida → 400.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Permission scope

Só `is_platform_admin`. Operação sensível — toda rotação auditada. Ver `docs/features/PERMISSIONS.md`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Exporta `createPlatformSecretsRouter()` p/ o orchestrator wire. **Nunca** retornar/logar `value_enc` decifrado.
