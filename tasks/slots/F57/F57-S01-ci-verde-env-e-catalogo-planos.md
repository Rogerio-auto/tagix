---
id: F57-S01
title: CI verde — ENCRYPTION_KEY no job + catálogo de planos self-contained nos testes
phase: F57
status: review
priority: critical
estimated_size: S
depends_on: []
blocks: [F57-S03, F57-S11]
agent_id: agent-f57-s01
source_docs:
  - .github/workflows/ci.yml
  - docs/audits/2026-08-08-fundacao-hm-init.md
claimed_at: 2026-08-10T16:00:31Z
completed_at: 2026-08-11T14:18:49Z

---
# F57-S01 — CI verde: env de teste completo + catálogo de planos self-contained

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). O CI do `main` está
> **vermelho desde ao menos 2026-06-30** (5 runs consecutivos). O run do HEAD atual
> (`53b6364e`, run `29623760575`) falha em `ci → Test` e `e2e → Run e2e (mocked)`.
> Como o job `deploy` declara `needs: [ci, python, e2e]`, ele é **skipped em todo
> push** — o CD nunca rodou. Nada bloqueia merge em `main`.

## Objetivo

Fazer `pnpm -r test` passar em um clone limpo com apenas Postgres/Redis/RabbitMQ de
pé e migrations aplicadas — sem depender de ordem de execução nem de seed global.

## Contexto / causa raiz (verificada, reproduzida local e no CI)

Duas causas independentes, ambas de ambiente — **nenhum bug de produto**:

1. **`ENCRYPTION_KEY` ausente no `env:` do job `ci`.** O bloco `env:` de
   `.github/workflows/ci.yml:44-48` define só `DATABASE_URL`, `REDIS_URL`,
   `AMQP_URL` e `NODE_ENV`. Todo teste que cifra segredo estoura
   `Error: Variável de ambiente obrigatória ausente: ENCRYPTION_KEY`:
   - `apps/api/src/routes/dev/routes.test.ts` (Webhooks CRUD — 3 testes)
   - `apps/api/src/routes/platform/models.test.ts`, `.../secrets.test.ts`
   - `apps/workers/src/webhooks/webhooks.test.ts` (6 testes)

2. **Catálogo de planos não semeado.** `provisionWorkspaceWithOwner`
   (`packages/db/src/provisioning/provision.ts:69`) aborta com
   `"Plano free ausente no catálogo. Rode os seeds de planos antes do signup."`.
   O CI roda `pnpm --filter @hm/db migrate` mas **nunca** `seed`, e nenhuma
   migration popula `plans` (`grep -c 'INSERT INTO plans' packages/db/drizzle/*.sql`
   = 0; `select count(*) from plans` num banco recém-migrado = 0). Falham:
   - `packages/db/src/provisioning/provision.test.ts` (6 testes)
   - `packages/db/src/rls.test.ts:1771` (`setup plan free`)
   - `apps/api/src/auth/flow.integration.test.ts` (3), `apps/api/src/auth/routes.test.ts` (1)

   Reprodução local bateu **idêntica** ao CI: `@hm/db` → 7 failed | 69 passed (76).

## Escopo (faz)

- Adicionar `ENCRYPTION_KEY` ao `env:` do job `ci` (valor de teste, 32 bytes hex
  fixo — é ambiente de CI, não segredo). Documentar no `.env.example` que a chave
  é obrigatória para rodar a suíte.
- Tornar os testes que dependem do catálogo **self-contained**: um helper
  idempotente (upsert do plano `free`, e dos plans pagos usados nas asserções) num
  `beforeAll` do próprio arquivo de teste. **Não** resolver adicionando
  `pnpm --filter @hm/db seed` ao CI: o seed é dado de desenvolvimento e acopla a
  suíte a ordem de execução e a um estado global mutável.
- Colocar o helper onde `@hm/db` e `@hm/api` possam reusar sem duplicar.

## Escopo (não faz)

- e2e (`ECONNREFUSED :3001`) → **F57-S02**.
- Gate de `pnpm audit` no CI → **F57-S03**.
- Piso de cobertura → **F57-S11**.
- Timeout de 5000ms em `apps/workers/src/dashboard-refresh/dashboard-refresh.test.ts`
  (`runSnapshotTick`): reproduz local em banco recém-migrado, **não** no CI.
  Investigar e, se for só custo de `REFRESH MATERIALIZED VIEW` a frio, subir o
  timeout do teste — cabe neste slot se for one-liner, senão abrir sub-slot.

## Arquivos permitidos

- `.github/workflows/ci.yml`
- `.env.example`
- `packages/db/src/provisioning/provision.test.ts`
- `packages/db/src/rls.test.ts`
- `packages/db/src/testing/**`
- `apps/api/src/auth/flow.integration.test.ts`
- `apps/api/src/auth/routes.test.ts`
- `apps/workers/src/dashboard-refresh/dashboard-refresh.test.ts`

## Arquivos proibidos

- `packages/db/src/provisioning/provision.ts` (a mensagem de erro está correta — o
  defeito é o ambiente de teste, não o código de produto)
- `packages/db/src/seed.ts`, `seed-owner.ts`, `seed-demo.ts`
- `packages/db/drizzle/**` (não semear catálogo via migration)

## Definition of Done

- [ ] Em clone limpo, com infra de pé + `pnpm --filter @hm/db migrate`, o comando
      `pnpm -r --if-present test` sai **0**, sem nenhum seed manual.
- [ ] `gh run list --branch main --limit 1` → `conclusion: success` no job `ci`.
- [ ] Nenhum teste depende de ordem entre packages (rodar `@hm/api` isolado passa).
- [ ] `ENCRYPTION_KEY` documentado como pré-requisito da suíte no `.env.example`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
```

## Notas

- **Por que isto é o slot mais importante da fase:** com o CI vermelho, todos os
  outros gates (typecheck, lint, RLS, 1.9k testes) existem mas não *bloqueiam* nada.
  407 slots foram entregues com o semáforo desligado.
- Estado real dos gates nesta auditoria (HEAD `53b6364e`): `pnpm typecheck` ✅ (12
  projetos), `pnpm lint` ✅ exit 0, zero `any` / zero `@ts-ignore`, ~1.900 testes com
  23 falhas — **todas** as 23 de ambiente, nenhuma de lógica de produto.
- Postgres local: a porta 5432 do host pode estar tomada por um Postgres nativo
  (ver **F57-S06**). Se `pnpm --filter @hm/db migrate` devolver `28P01 auth_failed`,
  é colisão de porta, não credencial errada.
