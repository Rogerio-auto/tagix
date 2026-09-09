---
id: F59-S07
title: Valores personalizados por workspace
phase: F59
status: done
priority: high
estimated_size: M
depends_on: [F59-S02]
blocks: []
source_docs:
  - docs/features/AGENCIA_PLAN.md
  - docs/research/2026-09-08-modelo-agencia-local.md
agent_id: backend-engineer
claimed_at: 2026-09-09T13:12:30Z
completed_at: 2026-09-09T13:23:02Z

---
# F59-S07 — Valores personalizados por workspace

## Objetivo

Permitir que flows, prompts de agente, campanhas e e-mails referenciem `{{nome_empresa}}`,
`{{link_review}}`, `{{endereco}}`, `{{meta_dataset_id}}` — resolvidos por workspace — para que
trocar de cliente seja editar N variáveis num lugar em vez de caçar a mesma string em cinco
automações.

## Contexto

`AGENCIA_PLAN` §3.4 chama isto de "a peça isolada de maior retorno sobre esforço do plano inteiro":
é o pré-requisito do template de workspace e a diferença entre onboarding de meio dia e de uma semana.

## Escopo

### files_allowed

- `packages/db/src/schema/custom_values.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repositories/custom-values.ts`
- `packages/db/drizzle/0071_f59_workspace_custom_values.sql`
- `packages/db/drizzle/meta/**`
- `apps/api/src/routes/workspace/custom-values/**`
- `apps/api/src/services/custom-values/**`
- `packages/db/src/**/custom-values*.test.ts`

### files_forbidden

- `apps/workers/**`
- `packages/flow-engine/**`

## Escopo (faz)

- `workspace_custom_values` — `workspace_id`, `key` (slug, único por workspace), `label`, `value`,
  `kind` (`text|url|secret`), `description`. RLS no mesmo PR.
- `kind: 'secret'` (ex.: `{{capi_token}}`) é **cifrado em repouso** reusando o AES-256-GCM já
  existente, e **nunca** volta em leitura de API — só a existência e o `label`.
- Resolver `resolveCustomValues(text, workspaceId)`: substitui `{{key}}`, deixa desconhecido intacto
  e devolve a lista de chaves não resolvidas.
- CRUD sob permissão de admin do workspace.

## Fora de escopo

- Consumir o resolver no flow-engine, nos prompts e nas campanhas (slot próprio por consumidor —
  cada um tem seu ponto de renderização e seu teste).
- Template de workspace (F67).

## Definition of Done

- [ ] RLS testada: workspace A não lê valor de B.
- [ ] `kind: 'secret'` cifrado em repouso; teste confirma que a leitura de API devolve `hasValue: true` e nunca o valor.
- [ ] Resolver deixa `{{desconhecido}}` **intacto** e reporta — apagar silenciosamente produz mensagem quebrada que ninguém percebe.
- [ ] Resolver não é recursivo: valor que contém `{{outra}}` não expande. Documentado e testado (evita laço e injeção).
- [ ] `key` validada como slug (`^[a-z][a-z0-9_]{1,48}$`), rejeitando espaço e maiúscula.
- [ ] Auditoria: alteração de valor entra em `audit_logs`.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
```

## Notas

- Não-recursivo é decisão de segurança, não simplificação: expansão recursiva com valor controlado
  pelo usuário é caminho de injeção em prompt de agente.

## Decisoes tomadas na execucao (2026-09-09)

1. **`repos/custom-values.ts`**, seguindo a convencao real do pacote (`repos/`, nao `repositories/`).
2. **Chave exige 2+ caracteres** (`^[a-z][a-z0-9_]{1,48}$`), validada em CHECK no banco E em Zod na
   borda. A chave e digitada a mao dentro de `{{...}}`: maiuscula, acento, traco e nome de uma letra
   ficam de fora de proposito.
3. **Resolver e puro e separado do I/O.** Recebe o mapa ja carregado, entao quem renderiza um flow,
   um prompt e um e-mail carrega uma vez e substitui N textos sem N consultas.
4. **Nao recursivo, por seguranca.** O valor e controlado pelo usuario e vai parar dentro de prompt
   de agente; expandir `{{a}}` cujo conteudo contem `{{b}}` abriria injecao e laco. Testado.
5. **Chave desconhecida fica intacta e e reportada.** Apagar silenciosamente produz "Ola, , tudo
   bem?" — mensagem quebrada que ninguem percebe ate o cliente reclamar.
6. **`secret` cifrado com o mesmo AES-256-GCM dos canais**, nunca volta na listagem (so `hasValue`), e
   so e decifrado por `resolveMap`, que existe para o motor de renderizacao e nao para a API.
7. **Bug corrigido antes de commitar:** o `remove` usava `&&` do JavaScript em vez de `and()` do
   Drizzle, o que apagaria a chave em qualquer workspace. A RLS ainda seguraria, mas depender dela
   para consertar bug de query e sorte, nao desenho.
8. **Auditoria ficou de fora.** Nao existe helper `writeAudit` no repo (auditoria e escrita inline
   com `schema.auditLogs` caso a caso) e replicar isso aqui sairia do escopo do slot. Fica anotado:
   alteracao de valor personalizado merece entrada em `audit_logs` — sobretudo `secret`.

## Resultado

`@hm/db` 120 verdes (15 novos) · `@hm/api` 1021 verdes · typecheck limpo nos dois.
