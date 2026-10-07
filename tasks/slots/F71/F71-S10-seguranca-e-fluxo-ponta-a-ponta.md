---
id: F71-S10
title: Auditoria de segurança da F71 e teste do fluxo inteiro de contas
phase: F71
status: in-progress
priority: high
estimated_size: M
depends_on: [F71-S07, F71-S08, F71-S09]
blocks: []
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/security
agent_id: backend-engineer
claimed_at: 2026-10-07T01:33:15Z

---
# F71-S10 — Segurança e fluxo ponta a ponta

## Objetivo

Provar que o fluxo inteiro funciona e que os controles do threat model (§6) seguram ataque de verdade.

## Escopo (faz)

- `/hm-security` focado em §6: token de convite, troca de empresa, só leitura, enumeração, RLS de `member_invites`, rate-limits, cookies e logs sem token nem senha. Cada achado com prova de conceito; corrigir o que for desta fase, e o que não for vira slot novo.
- Teste de integração da API (banco de dev real) cobrindo a jornada:
  1. signup → verify → login → empresa A ativa (trial de 15 dias);
  2. convidar B → aceite sem conta → login de B → B em A;
  3. B faz o próprio signup → tem A e a empresa própria → troca entre as duas;
  4. remover B de A → B não acessa mais A, segue na própria;
  5. trial de A vence (worker) → A só leitura → escrita 402, leitura 200.
- e2e do aceite de convite e da troca de empresa com a API mockada; atualizar `apps/web/e2e/fixtures/**`.
- Atualizar `docs/features/PERMISSIONS.md §7` (fluxo de convite real) e `docs/api-reference`, se as rotas estiverem documentadas lá.

### files_allowed

- `apps/api/src/**/*.integration.test.ts`
- `apps/api/test/**`
- `apps/web/e2e/**`
- `docs/features/PERMISSIONS.md`, `docs/features/CONTAS_E_CONVITES.md`, `docs/api-reference/**`, `docs/security/**`
- correções pontuais em arquivos da F71, com nota de correção no slot

## Definition of Done

- [ ] relatório de segurança em `docs/security/` com os achados e o que foi corrigido
- [ ] teste de integração da jornada verde
- [ ] e2e de convite e troca verde (ou roteiro manual registrado, se o host não aguentar)
- [ ] docs atualizados

## Validação

```bash
pnpm typecheck
pnpm lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/auth src/routes/workspace src/middlewares --maxWorkers=1
```

## Notas

- Agentes: `security-auditor` (auditoria) + `qa-engineer` (jornada e e2e).
