---
id: F44-S02
title: Provisioner isolado provisionWorkspaceWithOwner (privilegiado, idempotente, RLS-safe)
phase: F44
status: review
priority: high
estimated_size: M
depends_on: []
blocks: [F44-S04]
agent_id: backend-engineer
security_review: required
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
claimed_at: 2026-06-22T18:31:53Z
completed_at: 2026-06-22T18:35:41Z

---
# F44-S02 [SEC] — Provisioner de workspace + owner

> **source_docs:** `docs/features/SELF_SERVE_SIGNUP.md` §2, §3 (T8, T9, T13)
> **depends_on:** nenhum (onda 1). **blocks:** F44-S04.

## Objetivo

Extrair do `seed-owner.ts` um helper de domínio reutilizável e ISOLADO,
`provisionWorkspaceWithOwner(...)`, que cria o esqueleto de um tenant para o cadastro
self-serve: workspace + member OWNER (**sem `isPlatformAdmin`**) + subscription trial no
plano `free`. Idempotente e RLS-safe.

## Contexto

`seed-owner.ts` faz isso inline (workspace, member OWNER **com** `isPlatformAdmin:true`,
subscription trial free) mas é um script privilegiado de bootstrap. O signup precisa do
MESMO efeito porém: (a) `isPlatformAdmin:false` SEMPRE; (b) chamável de uma rota; (c)
idempotente por email/slug; (d) o passo privilegiado (criar workspace+member, que não tem
`workspace_id` no escopo ainda) corre fora de RLS, e QUALQUER recurso scoped subsequente
entrega `workspaceId` para rodar sob `withWorkspace` (RLS).

## Escopo (faz)

Novo módulo `packages/db/src/provisioning/` exportando:

```ts
provisionWorkspaceWithOwner(input: {
  ownerEmail: string;
  ownerName: string;
  authUserId: string;
  workspaceName: string;
  workspaceSlug?: string; // se ausente, deriva do nome com dedupe (slug é UNIQUE)
}): Promise<{ workspaceId: string; memberId: string; slug: string; created: boolean }>
```

- Deriva slug do nome (lowercase, kebab, ascii) com **dedupe** (slug é UNIQUE — colisão →
  sufixo incremental `-2`, `-3`...). Determinístico/idempotente: re-rodar com o mesmo email
  não duplica (retorna o existente, `created:false`).
- Cria workspace (`planId` = free, `subscriptionStatus:'trial'`), member OWNER
  (`role:'OWNER'`, `status` inativo até verify — **`pending`** se o enum suportar; senão
  documenta o estado), `isPlatformAdmin:false` SEMPRE, subscription trial free.
- O passo de criar workspace+member roda no caminho privilegiado (`getDb()` direto / fora de
  RLS, pois ainda não há `workspace_id` no contexto). Se o helper precisar instanciar recursos
  scoped, faz via `withWorkspace(workspaceId, ...)` — documentar a fronteira.
- Exportar de `packages/db/src/index.ts`.
- Testes de **isolamento RLS**: prova que um recurso scoped criado para o workspace A não é
  visível sob o escopo do workspace B; e que o member nasce com `isPlatformAdmin:false`.
- Refatorar `seed-owner.ts` para reusar o helper SE for trivial (passando
  `isPlatformAdmin` por um caminho separado/flag interna do script). Se a refatoração tocar
  além do necessário, deixar `seed-owner.ts` como está e só extrair a lógica — não regredir o seed.

## Fora de escopo

- Criar o user no Supabase (isso é S01/S04 — aqui só recebe `authUserId`).
- Rotas (S04). Aplicar blueprint de nicho (F43 já existe; signup só cria o esqueleto).

## Arquivos permitidos

- `packages/db/src/provisioning/**` (novo)
- `packages/db/src/index.ts` (só adicionar o export)
- `packages/db/src/seed-owner.ts` (apenas se reusar trivialmente o helper, sem regressão)

## Arquivos proibidos

- `apps/**`, `packages/shared/**`
- `packages/db/src/migrations/**` (não criar migration nova; usar o schema atual)

## Definition of Done

- [ ] `provisionWorkspaceWithOwner` exportado e idempotente (re-run não duplica).
- [ ] Member NUNCA recebe `isPlatformAdmin:true` (asserção em teste — T9).
- [ ] Slug derivado do nome com dedupe (colisão → sufixo).
- [ ] Passo privilegiado isolado; recursos scoped via `withWorkspace` (T8).
- [ ] Teste de isolamento RLS verde (workspace A não vê B).
- [ ] `seed-owner.ts` não regride (continua criando o owner platform-admin).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/db test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **backend-engineer**. [SEC] — gate antes do finish: T8 (isolamento RLS),
  T9 (sem platform admin / sem aceitar role do exterior), T13 (idempotência).
- `@hm/db` é sequencial entre si (migrations versionadas) — este slot NÃO cria migration.
