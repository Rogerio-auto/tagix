---
id: F6-S04
title: API recipients (bulk CSV + bulk opt-in) + opt-in/opt-out de contato
phase: F6
status: in-progress
priority: high
estimated_size: M
depends_on: [F6-S01]
agent_id: backend-engineer
claimed_at: 2026-06-11T04:58:47Z

---
# F6-S04 — API recipients + opt-in

> **source_docs:** `docs/features/CAMPAIGNS.md` §9, §12.3, §13; `docs/features/PERMISSIONS.md` (campaign.upload_recipients/bulk_optin); `docs/ROADMAP.md` F6-S04 (parte recipients), F6-S05 (parte registro)
> **blocks:** F6-S08

## Objetivo
Endpoints de recipients e consentimento: `POST /campaigns/:id/recipients/bulk` (CSV → valida E.164, dedup por phone reusando contact existente, opt-in batch na import), `POST /campaigns/:id/recipients/bulk-opt-in`, e `POST /contacts/:id/opt-in` + `/opt-out` (atualiza `contacts.marketing_opt_in`/`opt_in_*`/`opt_out_*` — colunas já existem de F1-S05).

## Escopo (faz)
- `apps/api/src/routes/campaigns/recipients.ts` + `apps/api/src/routes/contacts/opt-in.ts`: parsing CSV (mapping de colunas), validação E.164, dedup de contato, criação de `campaign_recipients`, e registro de opt-in/opt-out manual/bulk com `method`/`source`.

## Fora de escopo
- Opt-out automático por keyword (F6-S07, é hook do inbound), worker (F6-S05), UI de import (F6-S08).

## Arquivos permitidos
- `apps/api/src/routes/campaigns/recipients.ts`
- `apps/api/src/routes/contacts/opt-in.ts`

## Permission scope
- upload recipients → `campaign.upload_recipients` (MANAGERS); bulk opt-in → `campaign.bulk_optin` (ADMINS); opt-in/opt-out individual → `campaign.edit`/contact-edit (STAFF). Cite `permissions.ts`.

## Definition of Done
- [ ] Bulk CSV cria recipients com dedup de contato e opt-in batch; E.164 inválido rejeitado com relatório por linha.
- [ ] opt-in/opt-out atualizam as colunas de `contacts` com `method`/`source`/timestamp.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- As colunas de opt-in já existem em `contacts` (F1-S05) — este slot só escreve nelas. Se `opt_out_at`/`opt_out_reason` faltarem, F6-S01 os adiciona.
