---
id: F47-S11
title: QA + Segurança + e2e da F47
phase: F47
status: review
priority: high
estimated_size: M
depends_on: [F47-S02, F47-S03, F47-S04, F47-S05, F47-S06, F47-S07, F47-S08, F47-S09, F47-S10]
blocks: []
agent_id: qa-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-24T01:16:35Z
completed_at: 2026-06-24T01:16:37Z

---
# F47-S11 — QA, Segurança e e2e da feature

## Objetivo

Validar a feature inteira ponta a ponta: RLS multi-tenant das novas tabelas, authz das novas
permissões, edge cases (drift de valor, dedup de conversão, auto-create), e fluxos de UI.

## Contexto

Slot de fechamento da F47. Caça os riscos mapeados na spec (§7/§8) antes do merge/deploy.

## Escopo (faz)

- **Segurança (security-auditor):**
  - RLS em `products` e `deal_items` — insert/select/update cross-workspace bloqueado.
  - Authz: `product.edit` (ADMINS), `deal.edit`/`deal.convert` (STAFF), `contact.edit` — READONLY
    e roles sem permissão recebem 403; UI esconde controles.
  - Validação Zod de address/document (UF/CEP/CPF-CNPJ) — input malformado não passa.
  - `POST /api/conversations/:id/deal` respeita visibilidade da conversa (sem IDOR).
- **Edge cases:**
  - **Drift de `value_cents`**: add/edit/delete de itens concorrentes → soma sempre correta.
  - Produto soft-deleted ainda referenciável em item antigo (snapshot).
  - **Dedup de conversão** (409 same-day) com valor herdado.
  - Auto-create idempotente (não cria 2 deals para a mesma conversa).
  - Snapshot no fechamento grava o cadastro vigente.
  - ViaCEP indisponível → degradação honesta (preenche manual).
- **e2e (best-effort):** fluxo cockpit → enriquecer cliente → criar card/itens → marcar conversão;
  catálogo de produtos em settings; logout pela sidebar. (Lembrar: e2e Playwright não hidrata no
  Windows local — validar web por typecheck/lint/build/unit; e2e roda no CI.)

## Fora de escopo

- Implementar correções estruturais (devolver ao slot dono se achar bug grande).

## Arquivos permitidos

- `apps/api/src/**/*.test.ts` (testes adicionais de integração/authz/RLS)
- `apps/web/e2e/**` (specs e2e da feature)
- `packages/db/src/rls.test.ts` (cobertura extra se necessário)
- `apps/web/features/**/*.test.ts(x)` (unit de componentes críticos, ex.: recompute/herdar valor)

## Arquivos proibidos

- Código de produção dos outros slots (só testes). Se precisar mudar produção, abrir follow-up.

## Definition of Done

- [ ] RLS das 2 tabelas testada (cross-workspace negado); authz das perms novas testada.
- [ ] Drift de valor, dedup de conversão, auto-create idempotente e snapshot cobertos por teste.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` + `pnpm --filter @hm/db test`
      + `pnpm --filter @hm/web build` verdes.
- [ ] Relatório de QA com gaps encontrados (e quais viraram follow-up).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas

- Co-executar com `security-auditor` para a parte de RLS/authz/IDOR (memória F30: assertConversationVisible
  fechou IDOR — checar que `:id/deal` herdou esse cuidado).
- e2e no Windows local não hidrata (memória) — não reprovar o slot por isso; rodar a suíte no CI.
