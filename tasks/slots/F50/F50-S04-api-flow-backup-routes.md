---
id: F50-S04
title: Rotas de backup de Flows (export/preview/import)
phase: F50
status: done
priority: high
estimated_size: M
depends_on: [F50-S02, F50-S03]
blocks: [F50-S05]
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
claimed_at: 2026-06-26T19:58:00Z
completed_at: 2026-06-26T20:00:31Z

---
# F50-S04 — Rotas de backup de Flows

## Objetivo

Expor os 3 endpoints REST do backup, gated por `flow.backup`, sob RLS, com parser JSON dedicado para
os payloads grandes de import.

## Contexto

Consome o serviço de S03 e a permissão de S02. Monta antes do CRUD de `/api/flows/:id` para precedência
das rotas literais.

## Escopo (faz)

- `apps/api/src/routes/flows/backup.ts` (criar): router com guards `[requireAuth, withRLS,
  requireRole('flow.backup')]`, tudo em `req.scoped`:
  - `GET /api/flows/backup/export` → 200 `BackupEnvelope` + header `Content-Disposition: attachment;
    filename="leadium-flows-backup-<YYYY-MM-DD>.json"`. Zod opcional `?ids=uuid,uuid` (futuro).
  - `POST /api/flows/backup/preview` → 200 `PreviewResult`; 422 `version_incompatible` (formatVersion≠1
    ou app≠leadium) / `checksum_mismatch`.
  - `POST /api/flows/backup/import` → 200 `ImportResult`; body `{envelope, confirmedChecksum, mode?}`;
    confere `confirmedChecksum === envelope.checksum.value` (mesmo arquivo do preview); 400 invalid_payload.
- `apps/api/src/routes/flows/index.ts`: `router.use(createFlowBackupRouter())` ANTES do CRUD.
- `apps/api/src/app.ts`: registrar `express.json({limit:'10mb'})` dedicado para
  `['/api/flows/backup/import','/api/flows/backup/preview']` ANTES do `express.json({limit:'1mb'})` global.
- `apps/api/src/routes/flows/backup.test.ts`: supertest (padrão `flows/routes.test.ts`).

## Fora de escopo

- Lógica de export/import (S03). UI (S05).

## Arquivos permitidos

- `apps/api/src/routes/flows/backup.ts`
- `apps/api/src/routes/flows/backup.test.ts`
- `apps/api/src/routes/flows/index.ts` (apenas montar o novo router)
- `apps/api/src/app.ts` (apenas o parser dedicado)

## Arquivos proibidos

- `apps/api/src/services/flow-backup/**` (S03), `apps/api/src/routes/flows/crud.ts`
- `packages/**`, `apps/web/**`

## Contratos (entrada/saída)

- `GET /api/flows/backup/export` → `BackupEnvelope` (+ attachment header).
- `POST /api/flows/backup/preview` `{ envelope }` → `PreviewResult`.
- `POST /api/flows/backup/import` `{ envelope, confirmedChecksum, mode? }` → `ImportResult`.

## Definition of Done

- [ ] 401 sem sessão; 403 para role não-ADMIN em todos os 3 endpoints.
- [ ] export 200 com checksum válido; preview reporta resumo sem escrever; import cria drafts.
- [ ] payload acima de 10mb → 413; checksum adulterado → 422; app/formatVersion errados → 422.
- [ ] parser dedicado montado ANTES do json global (bundle grande não toma 413 prematuro).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

- Os 3 endpoints exigem `flow.backup` (OWNER/ADMIN). Ver S02 / `docs/features/PERMISSIONS.md`.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Espelhar erros no shape do CRUD (`invalid_payload` com issues do Zod).
- `confirmedChecksum` garante que o arquivo importado é o mesmo revisado no preview.
