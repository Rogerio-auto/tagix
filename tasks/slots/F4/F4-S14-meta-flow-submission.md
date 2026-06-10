---
id: F4-S14
title: Meta flow_submission webhook + trigger flow (flow_submission)
phase: F4
status: in-progress
priority: medium
estimated_size: S
depends_on: [F4-S01, F4-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:43:37Z

---
# F4-S14 — Meta flow_submission webhook

> **source_docs:** `docs/features/FLOW_BUILDER.md` §5 (trigger flow_submission), DATA_MODEL §9.5; `docs/ROADMAP.md` F4-S18
> **blocks:** —

## Objetivo
Receber respostas de WhatsApp Flows (Meta): persistir em `flow_submissions` e disparar flows com trigger `flow_submission` que casam o `meta_flow_id`. Plugado no webhook Meta unificado (F1-S02) por despacho de field.

## Escopo (faz)
- `apps/api/src/routes/flows/submissions.ts`: handler que parseia o payload de flow response, persiste `flow_submissions` (RLS, dedup por `external_id`/wamid), resolve/cria conversation, e dispara `triggerFlow({ triggeredBy: 'automatic' })` para flows `flow_submission` que casam `meta_flow_id`.
- O despacho a partir do webhook Meta unificado (F1-S02) para este handler é gap-fill do orchestrator (1-2 linhas), mantendo o webhook F1 intocado fora do ponto de extensão.

## Fora de escopo
- Webhook signature/verify/dedup base (F1-S02, já existe), engine (F4-S02), envio do Meta Flow (handler `meta_flow`, F4-S04).

## Arquivos permitidos
- `apps/api/src/routes/flows/submissions.ts`

## Arquivos proibidos
- `apps/api/src/routes/flows/**` exceto `submissions.ts` (CRUD é dono de F4-S08)

## Definition of Done
- [ ] Flow response Meta → `flow_submissions` persistido (dedup) → flow `flow_submission` correspondente disparado.
- [ ] Sem flow correspondente → persiste e no-op (sem erro).
- [ ] `pnpm --filter @hm/api test` (webhook/engine mockados) + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- `flow_submissions.workspace_id` resolvido pelo `channel_id` do webhook (mesmo caminho de tenant-resolution do F1-S02).
