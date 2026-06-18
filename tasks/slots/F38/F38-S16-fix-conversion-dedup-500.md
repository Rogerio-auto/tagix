---
id: F38-S16
title: Fix 500 no dedup de conversões (ON CONFLICT DO NOTHING)
phase: F38
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/features/SUPPORT.md
  - tasks/COMMS.md
agent_id: backend-engineer
---
# F38-S16 — Fix dedup de conversões (causa-raiz do 500)

## Objetivo

Corrigir um bug latente pré-existente descoberto durante o F38-S12: o `catch` da violação UNIQUE do dedup same-day de conversões não faz rollback do statement → envenena a transação RLS → 500. O S12 mitigou só o caminho do agente (pré-check); a **rota manual `/api/conversions`** ainda quebra. Corrigir na causa-raiz com `ON CONFLICT DO NOTHING`.

## Contexto

Ver achado em `tasks/COMMS.md` (F38-S12). O dedup é um UNIQUE same-day; ao inserir uma conversão duplicada no mesmo dia, o INSERT viola a constraint e o handler atual tenta capturar o erro dentro da mesma transação RLS, que já foi abortada pelo Postgres.

## Escopo (faz)

- **`apps/api/src/routes/conversions/register.ts`** — trocar o padrão try/catch da violação UNIQUE por `INSERT ... ON CONFLICT DO NOTHING` (ou `ON CONFLICT <constraint> DO NOTHING`), retornando o resultado idempotente esperado (conversão já existente same-day → no-op/200 com o registro existente, sem 500). Não alterar contrato de resposta.
- **Teste de dedup** — no test file da rota de conversões (`apps/api/src/routes/conversions/*.test.ts`): segunda conversão same-day NÃO retorna 500; é idempotente; a transação não fica envenenada (operação seguinte na mesma request funciona).

## Fora de escopo

- Mudar a regra de dedup. Schema/migration. Lógica do agente (já mitigada no S12).

## Arquivos permitidos

- `apps/api/src/routes/conversions/register.ts`
- `apps/api/src/routes/conversions/register.test.ts`
- `apps/api/src/routes/conversions/conversions.test.ts`

## Arquivos proibidos

- `packages/**`, `apps/web/**`

## Definition of Done

- [ ] Conversão duplicada same-day é idempotente (sem 500) na rota manual e no caminho do agente.
- [ ] Teste de dedup cobre o cenário e a não-contaminação da transação.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

Confirmar o nome exato da constraint UNIQUE (dedup same-day) no schema antes de referenciá-la no `ON CONFLICT`. Se o test file da rota tiver outro nome, ajustar via COMMS.md — manter a fronteira em `routes/conversions/**` de teste.
</content>
