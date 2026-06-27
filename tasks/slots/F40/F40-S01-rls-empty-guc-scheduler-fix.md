---
id: F40-S01
title: Fix RLS — GUC app.workspace_id vazio ('') quebra queries cross-tenant (schedulers)
phase: F40
status: done
priority: high
estimated_size: M
depends_on: []
agent_id: db-engineer
source_docs:
  - docs/features/PERMISSIONS.md
blocks: []
completed_at: 2026-06-27T03:13:25Z

---
# F40-S01 — Fix RLS: GUC vazio quebra schedulers cross-tenant

> **source_docs:** evidência de produção (deploy F39, 2026-06-19) + `packages/db/src/rls.ts`
> Bug **pré-existente**, achado no deploy de produção. NÃO é da F39.

## Objetivo

Corrigir, na fundação RLS, o bug que faz os ticks de scheduler dos workers (`flow-wakeup` e `automations`) falharem **toda iteração** em produção, sem reintroduzir vazamento entre tenants.

## Contexto / causa raiz (confirmada)

`withWorkspace` (`packages/db/src/rls.ts`) faz `set local role hm_app` + `set_config('app.workspace_id', wsId, true)` (local) — correto, escopado à transação. **Porém**: um GUC customizado (`app.workspace_id`), uma vez setado via `set_config(local)` numa conexão física, ao fim da transação **reverte para string vazia `''`**, não para `NULL` (comportamento do PostgreSQL para placeholder GUCs). 

Os schedulers cross-tenant (`apps/workers/src/flows/scheduler.ts` `selectDue`, `apps/workers/src/automations/worker.ts` `selectDue`) consultam via `getDb().execute(...)` **fora** de `withWorkspace`. Quando reusam do pool uma conexão que já passou por `withWorkspace`, a RLS **forçada** de produção avalia a policy `workspace_id = (current_setting('app.workspace_id', true))::uuid` com `''` → o cast **`''::uuid` lança** `invalid input syntax for type uuid: ""`. 

Evidência: a query roda como `leadium`/owner em `psql` numa conexão fresca → `current_setting(...)` = NULL → 0 rows, **sem erro**. Na conexão envenenada do worker → erro determinístico a cada tick (a cada 30s). **Impacto:** agendamento de flows com atraso + automações de deal **não disparam** em produção. Não afeta mensageria/coexistência (essas usam `withWorkspace` por mensagem).

## Escopo (faz)

- **Tornar as RLS policies tolerantes a `''`**: trocar `(current_setting('app.workspace_id', true))::uuid` por `nullif(current_setting('app.workspace_id', true), '')::uuid` em TODAS as policies que fazem esse cast (assim `''` vira NULL → 0 rows, sem erro; isolamento preservado). Preferir introduzir/usar **uma função helper** (ex.: `app_current_workspace()` retornando `nullif(current_setting('app.workspace_id', true), '')::uuid`) e referenciá-la nas policies, para centralizar — se o custo de reescrever todas as policies for alto, a função é o caminho.
- **Migration versionada** (drizzle) que recria as policies/cria a função, **idempotente** e segura (não derruba isolamento durante o apply).
- Garantir consistência com `set_config(..., true)` em `rls.ts` (o helper continua válido; o fix é na leitura da policy).

## Fora de escopo

- Reescrever os schedulers (o fix correto é na policy — beneficia toda query cross-tenant via `getDb()`). Só toque em `apps/workers/**` se for estritamente necessário e, nesse caso, abra sub-slot — este slot é DB.
- Qualquer mudança de comportamento de tenant-isolation além de tratar `''` como "sem workspace".

## Arquivos permitidos

- `packages/db/**`

## Arquivos proibidos

- `apps/**` · `packages/channels/**`

## Definition of Done

- [ ] Migration aplica e recria as policies (ou helper) com `nullif(..., '')::uuid`; `pnpm --filter @hm/db migrate` idempotente.
- [ ] **Regressão reproduzida e corrigida:** teste que (a) roda um `getDb()` cross-tenant LOGO APÓS um `withWorkspace` na mesma conexão e **não lança** mais (antes do fix, lança `invalid input syntax for type uuid: ""`); (b) prova que tenant isolation continua: dentro de `withWorkspace(A)` não se lê dados do workspace B.
- [ ] RLS policy criada/recriada e testada (obrigatório — slot mexe em RLS).
- [ ] `pnpm --filter @hm/db test` + lint/typecheck verdes.

## Permission scope

Mexe na fundação RLS multi-tenant (isolamento). Ver `docs/features/PERMISSIONS.md`. Mudança security-sensitive — o teste de isolamento é parte do DoD, não opcional.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **db-engineer**. Confirme primeiro como as policies são definidas (inline nas migrations vs schema) com um `\d <tabela>` / grep por `current_setting('app.workspace_id'` nas migrations existentes, e descubra quantas tabelas/policies usam o cast.
- O fix `nullif(current_setting('app.workspace_id', true), '')::uuid` é o padrão robusto: trata tanto NULL (conexão fresca) quanto `''` (conexão pós-withWorkspace) como "sem workspace" → policy nega tudo (0 rows) em vez de estourar.
- Pós-merge: re-deploy de produção e confirmar nos logs dos workers que `flow-wakeup`/`automations` param de logar "Failed query".
