---
id: F59-S09
title: Pendências de conformidade — esclarecimento único e auditoria de valores
phase: F59
status: available
priority: high
estimated_size: S
depends_on: [F59-S06, F59-S07]
blocks: []
agent_id: backend-engineer

---
# F59-S09 — Pendências de conformidade

## Objetivo

Entregar os dois itens que a F59-S06 e a F59-S07 prometiam e não entregaram.

## Contexto

Auditoria de 2026-09-14. A F59-S06 detecta revogação e suprime, mas não envia a mensagem de
esclarecimento quando a confiança é intermediária. A F59-S07 guarda valores personalizados,
inclusive segredos, sem registrar em `audit_logs` quem alterou o quê.

## Escopo

### files_allowed

- `apps/workers/src/inbound/revocation.ts`
- `apps/workers/src/inbound/*.test.ts`
- `packages/shared/src/revocation.ts`
- `packages/shared/src/revocation.test.ts`
- `packages/db/src/schema/revocation_clarifications.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `packages/db/src/repos/custom-values.ts`
- `packages/db/src/custom-values.test.ts`
- `apps/api/src/routes/workspace/**`

### files_forbidden

- `packages/shared/src/consent.ts`

## Escopo (faz)

- Mensagem de esclarecimento para revogação de confiança intermediária, enviada **uma vez** por
  contato e canal, com idempotência estrutural (índice único), no idioma do contato.
- Toda criação, alteração e remoção de valor personalizado grava `audit_logs` com autor, chave e
  tipo — **nunca o valor de um segredo**.

## Fora de escopo

- Mudança nos limiares de confiança.

## Definition of Done

- [ ] Esclarecimento sai uma vez; segunda detecção igual não envia de novo — teste cobre.
- [ ] Esclarecimento respeita supressão e janela de silêncio.
- [ ] Alteração de valor grava `audit_logs`; segredo aparece como alterado, sem o valor — teste cobre.

## Validação

```bash
pnpm --filter @hm/shared test
pnpm --filter @hm/workers test
pnpm --filter @hm/db test
pnpm lint
```

## Notas

- A régua: nenhuma revogação ambígua fica sem pergunta, e nenhuma pergunta é feita duas vezes.
