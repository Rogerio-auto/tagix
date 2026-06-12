---
id: F10-S02
title: LGPD — data export + delete (direito ao esquecimento)
phase: F10
status: review
priority: high
estimated_size: M
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/ROADMAP.md#F10-S05
  - docs/DATA_MODEL.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-12T13:56:37Z
completed_at: 2026-06-12T13:57:44Z

---
# F10-S02 — LGPD: export + delete

> **source_docs:** `docs/ROADMAP.md` F10-S05; `docs/DATA_MODEL.md`; `docs/features/PERMISSIONS.md`
> **blocks:** —

## Objetivo

Conformidade LGPD: endpoint de **export** de todos os dados pessoais de um titular (contato) e/ou do workspace, e endpoint de **delete/anonimização** (direito ao esquecimento) que apaga/anonimiza PII em cascata e registra a operação em `audit_logs`. Export pesado roda como **job assíncrono** no worker.

## Contexto

Multi-tenant com RLS. O export precisa reunir PII espalhada (contatos, mensagens, conversas, deals, conversões) respeitando o `workspace_id`. O delete precisa anonimizar/remover sem quebrar integridade referencial nem métricas agregadas históricas (anonimiza, não deleta linha de fato quando há FK de agregado).

## Escopo (faz)

- `packages/db`: tabela `data_export_jobs` (status, requested_by, scope, artifact_url, expires_at) + migration versionada + **RLS policy** por `workspace_id` + repo.
- `apps/api/src/routes/privacy/**` + `apps/api/src/services/privacy/**`: `POST /privacy/exports` (cria job), `GET /privacy/exports/:id` (status/download), `POST /privacy/contacts/:id/forget` (anonimiza/deleta PII do contato + cascata) — todos Zod-validados e gated por permissão.
- `apps/workers/src/privacy/**`: consumer que monta o artefato de export (JSON/zip) a partir do scope, grava via `@hm/storage`, marca `data_export_jobs.status`.
- Testes (happy path + RLS cross-tenant nega).

## Fora de escopo

- Wire dos routers/consumer em `app.ts`/`main.ts` (orchestrator).
- UI de privacidade (follow-up / seção settings).

## Arquivos permitidos

- `packages/db/**`
- `apps/api/src/routes/privacy/**`
- `apps/api/src/services/privacy/**`
- `apps/workers/src/privacy/**`

## Arquivos proibidos

- `apps/api/src/app.ts`, `apps/workers/src/main.ts`, `apps/workers/src/bootstrap/**`

## Contratos de entrada/saída

- `POST /privacy/exports` body `{ scope: 'workspace' | { contactId: string } }` → `{ jobId }`.
- `GET /privacy/exports/:id` → `{ status, downloadUrl? }`.
- `POST /privacy/contacts/:id/forget` → `{ anonymized: true }` + `audit_logs` entry.

## Definition of Done

- [ ] Export assíncrono reúne toda PII do scope e gera artefato baixável com expiração.
- [ ] Forget anonimiza/deleta PII do contato em cascata + registra em `audit_logs`; agregados históricos não quebram.
- [ ] RLS policy criada e **testada** (cross-tenant nega leitura de `data_export_jobs`).
- [ ] Permission scope: só `owner`/`admin` (cf. `docs/features/PERMISSIONS.md §2`).
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Permission scope

`owner` e `admin` do workspace. Endpoints negam `agent`/`viewer`. Ver `docs/features/PERMISSIONS.md §2`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer** (toca schema → inclui RLS no mesmo PR, regra do PROTOCOL).
- Único slot da F10 que toca `packages/db` — sem conflito de migration paralela.
- Anonimização: substituir PII por tokens determinísticos (`deleted-{hash}`) preservando FKs de agregados; mensagens com conteúdo PII → redigir corpo.
