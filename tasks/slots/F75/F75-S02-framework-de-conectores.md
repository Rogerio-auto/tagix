---
id: F75-S02
title: Pacote @hm/integrations com contrato de conector, E/S guardada, paginação e kit de conformidade
phase: F75
status: available
priority: critical
estimated_size: L
model: opus
depends_on: []
blocks: [F75-S03, F75-S04, F75-S05, F75-S07]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/decisions/ADR-005-conectores-cofre-e-loja-de-integracoes.md
agent_id: backend-engineer
---
# F75-S02 — Framework de conectores

## Objetivo

Existe um pacote `@hm/integrations` onde um conector é um manifesto declarativo validado por Zod mais uma
implementação com `auth`, `detectError`, `pull`, `push`, `webhook` e `sample`, e toda E/S de rede passa por um
contexto que aplica SSRF guard, timeout, teto de bytes, rate limit e redação de log. Um kit de conformidade prova
as lições Maian contra fakes de SQL somente leitura, MCP por polling e REST.

## Contexto

Spec §4.1, §3 (lições L1–L6), ADR-005 §2. Não toca banco: pode começar já, em paralelo à F73. É a base de S03,
S04, S05, S06, S07 e S12.

## Escopo (faz)

- Pacote novo `packages/integrations` (`@hm/integrations`), TS strict, sem `any`, `exports` com subpaths
  `.`, `./testing` e `./server` (o `./server` é server-only; o vault entra nele no S03).
- `src/core/manifest.ts`: `ConnectorManifestSchema` (Zod) com **todos** os campos da spec §4.1; tipos inferidos.
  Regras de validação: `entities[].keyField` obrigatório; modos `sql_readonly`/`mcp_polling` não podem declarar
  direção `push` (refine com mensagem); `limits.maxRowsPerResponse` ≥ 1; `requiredFeature` não vazio.
- `src/core/connector.ts`: interface `Connector` e tipos `PullPage`, `ExternalRecord` (`externalId: string`,
  `externalScope: string | null`), `PageRequest`, `PushResult`, `NormalizedEvent`, `ConnectorError`
  (classificação: `auth`, `rate_limited`, `transient`, `invalid_response`, `truncated_response`,
  `remote_error`, `not_found`, `forbidden_write`).
- `src/core/registry.ts`: `registerConnector(c)` valida o manifesto e **recusa** conector sem `detectError` ou com
  `push` em modo só leitura; `getConnector(id)`, `listManifests()`.
- `src/core/context.ts`: `createConnectorContext({ connectionId, workspaceId, manifest, credentials, logger,
  signal, fetchImpl? })` com:
  - `ctx.fetch`: `ssrfSafeFetch` + `createGuardedLookup` de `@hm/shared/net`, só `https` (exceto hosts de
    `httpAllowlistFromEnv()` em dev/teste), `timeoutMs` do manifesto, **teto de bytes** `maxBytesPerResponse`
    lido em streaming (aborta acima), redirect revalidado, rate limit por conexão (token bucket em memória por
    processo; a versão distribuída em Redis entra no S04);
  - `ctx.credentials()`: função injetada (o S03 liga ao vault); nunca serializável, nunca logada;
  - `ctx.logger`: wrapper do `@hm/logger` com redação das chaves `authorization`, `token`, `secret`, `password`,
    `dsn`, `ciphertext`, `api_key`, `cookie`.
- `src/core/paging.ts`: `paginate(connector, ctx, req)` async iterator; página com `records.length >=
  maxRowsPerResponse` e `nextCursor === null` ⇒ lança `truncated_response` (L1); `maxPagesPerRun` respeitado.
- `src/core/keys.ts`: `ExternalKeySchema` = string não vazia, `.trim()`, sem conversão numérica; helper
  `assertStringKey(value)` que **rejeita `number`** (L3) com erro claro.
- `src/core/detect-error.ts`: `defaultDetectError(status, body)` que reconhece erro em 200 (`{ erro }`,
  `{ error }`, `{ success: false }`, `{ status: 'error' }`, `{ ok: false }`, `{ isError: true }` do MCP) — cada
  conector pode compor com o padrão (L2).
- `src/catalog/`: manifestos **declarativos** do catálogo de lançamento (sem implementação):
  `generic-webhook` (Conectar qualquer sistema), `generic-rest` (API REST genérica), `csv-import` (Planilha e CSV)
  e o card `outbound-webhooks` (aponta para a tela existente de webhooks de saída, sem conexão). Cards "Em breve"
  só entram quando o Rogério decidir a lista (pergunta aberta); deixar `catalog/soon.ts` com array vazio tipado.
- `src/copilot.ts`: tipo `CopilotToolSpec` e `listActiveIntegrationTools` **como assinatura** (spec §11), sem
  execução.
- `packages/shared/src/integrations/` (novo subpath `@hm/shared/integrations` em `packages/shared/package.json`):
  Zod dos DTOs da spec §6, um arquivo por domínio, cada um com um dono declarado no cabeçalho:
  `targets.ts` (destinos canônicos fechados, S02), `mapping.ts` (S05), `catalog.ts`, `connections.ts`,
  `requests.ts` (S07), `credentials.ts` (S03), `test-run.ts` (S04), `inbound.ts` (S06), `health.ts` (S08),
  `index.ts` (barrel, S02). Este slot escreve a primeira versão de todos a partir da spec; os donos refinam.
- `src/testing/` (`@hm/integrations/testing`):
  - `fakeSqlReadonly({ rows, cap: 500, errorIn200?: boolean })`: conector `sql_readonly` falso que corta em 500
    linhas sem cursor como o MCP do ERP da Maian;
  - `fakeMcpPolling(...)`: devolve `{ isError: true, content }` dentro de 200 quando configurado;
  - `fakeRest(...)`: paginação por cursor e por página, 429 com `Retry-After`;
  - `runConformance(connector, fixtures)`: suíte que todo conector chama no próprio teste.
- Regra de lint do pacote (no `eslint` do pacote ou no config raiz por override de path): `@hm/integrations/src/**`
  não importa `pg`, `@hm/db`, `node:http`, `node:https`, `node:net`.

## Fora de escopo

- Cofre/decifra (S03), motor com banco (S04), motor de mapeamento (S05), conectores reais (S06, S12).

### files_allowed

- `packages/integrations/**`
- `packages/shared/src/integrations/**`
- `packages/shared/package.json`
- `pnpm-lock.yaml`
- `tsconfig.base.json`
- `eslint.config.mjs`

### files_forbidden

- `packages/db/**`, `apps/**`

## Definition of Done

- [ ] `@hm/integrations` compila, sem `any`, com `exports` `.`, `./testing`, `./server`
- [ ] teste: manifesto `sql_readonly` com `push` é rejeitado; conector sem `detectError` é recusado no registro
- [ ] teste L1: `fakeSqlReadonly` com 1.200 linhas e corte em 500 ⇒ `paginate` lança `truncated_response`
- [ ] teste L2: `{ "erro": "Filial inválida" }` com HTTP 200 ⇒ `remote_error`; `isError: true` do MCP ⇒ erro
- [ ] teste L3: chave `000123` sobrevive ponta a ponta; chave numérica é rejeitada
- [ ] teste L4: dois registros com o mesmo código e filiais diferentes são distintos
- [ ] teste SSRF: `ctx.fetch` para `169.254.169.254`, `127.0.0.1`, `10.0.0.1`, host com DNS que resolve para IP
      privado e redirect para IP privado ⇒ bloqueado
- [ ] teste: resposta acima de `maxBytesPerResponse` aborta; timeout respeitado; log não contém o token
- [ ] `runConformance` exportado e usado nos testes dos três fakes
- [ ] lockfile atualizado com `corepack pnpm@11.5.2 install` (nunca o pnpm global)

## Validação

```bash
corepack pnpm@11.5.2 install --frozen-lockfile
pnpm --filter @hm/integrations typecheck
pnpm --filter @hm/integrations lint
pnpm --filter @hm/integrations exec vitest run --maxWorkers=1
pnpm --filter @hm/shared typecheck
```

## Notas

- Agente: `backend-engineer`. Use `@hm/shared/net` (já tem `ssrfSafeFetch` com teto de 64 KiB; aqui o teto é o
  do manifesto, então o contexto lê o corpo em streaming com o próprio limite e usa o `createGuardedLookup`).
- `tsconfig.base.json`/`eslint.config.mjs` só se o pacote novo precisar de path alias ou override; se não
  precisar, não toque.
- Os textos do manifesto (resumo, permissões) são PT-BR de produto, no tom da maquete B2.
