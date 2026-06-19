---
id: F42-S05
title: Worker de recorrência PIX + dunning + execução de cancel-at-period-end
phase: F42
status: done
priority: high
estimated_size: M
depends_on: [F42-S02, F42-S03]
blocks: [F42-S09]
agent_id: backend-engineer
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
---

# F42-S05 — Recorrência PIX + dunning

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §6
> **blocks:** F42-S09

## Objetivo

Worker agendado (in-process scheduler dos workers) que, para assinaturas **PIX** (sem débito
automático), gera a cobrança do próximo ciclo perto do `current_period_end` e aplica a régua de
dunning (lembrete → tolerância → `past_due` → corte). Também executa `cancel_at_period_end`.

## Contexto

Cartão renova sozinho (ouvido pelo webhook S03 `renewed`). PIX precisa de geração ativa por ciclo.
Consome `@hm/payments` (`createPixCharge`) e o schema (S02). Cross-tenant: roda como scheduler —
respeitar o GUC de RLS por workspace (gotcha conhecido do scheduler/RLS).

## Escopo (faz)

- `apps/workers/src/billing/recurrence.ts`: varredura idempotente por ciclo (uma cobrança por
  `(subscription, period)`), gera PIX, agenda dunning, marca `past_due`/corte na expiração.
- `apps/workers/src/billing/index.ts`: handle do worker (`start`/`stop`) no padrão dos demais.
- Registro no composition root `apps/workers/src/bootstrap/index.ts` + export em `apps/workers/src/index.ts`.
- Testes da régua (gera 1×/ciclo; tolerância; transição para `past_due`/corte).

## Fora de escopo

- Recorrência de cartão (nativa, via webhook S03). Webhook handler (S03). UI/notificação visual.

## Arquivos permitidos

- `apps/workers/src/billing/**`
- `apps/workers/src/bootstrap/index.ts`
- `apps/workers/src/index.ts`

## Arquivos proibidos

- `apps/api/**`, `packages/db/src/schema/**`

## Definition of Done

- [ ] Gera no máximo uma cobrança PIX por `(subscription, period)` (idempotente).
- [ ] Dunning transiciona `active`→`past_due`→corte respeitando tolerância configurada.
- [ ] RLS por workspace respeitado no scheduler (GUC setado por tenant).
- [ ] `pnpm --filter @hm/workers test` + typecheck + lint verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Especialista: **backend-engineer**. Cuidado com o bug conhecido de GUC vazio quebrando schedulers
  cross-tenant (F40-S01) — setar o workspace no contexto antes de cada query.
