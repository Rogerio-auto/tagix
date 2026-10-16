---
id: F75-S03
title: Cofre de credenciais com keyring por versão e AAD, OAuth genérico com PKCE e recifra de chaves
phase: F75
status: blocked
priority: critical
estimated_size: M
model: opus
depends_on: [F75-S01, F75-S02, F75-S07]
blocks: [F75-S04, F75-S10, F75-S13]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/decisions/ADR-005-conectores-cofre-e-loja-de-integracoes.md
  - docs/runbooks/rotate-encryption-key.md
agent_id: backend-engineer
---
# F75-S03 — Cofre, keyring e OAuth genérico

## Objetivo

Credencial de integração entra cifrada com AES-256-GCM, versão de chave real e AAD amarrada à empresa e à
conexão, e só o vault a decifra. A rotação de `ENCRYPTION_KEY` deixa de exigir troca às cegas: existe keyring
por versão e um job que recifra todas as colunas cifradas do sistema. O assistente consegue autorizar por OAuth
(Authorization Code + PKCE) em qualquer provedor declarado no manifesto, e por chave de API colada.

## Contexto

ADR-005 §3. Achado de 16/10: `getKey(_keyVersion)` em `packages/db/src/crypto.ts` ignora a versão e o payload não
tem prefixo nem AAD; o runbook de rotação não cobre `meta_connections.access_token_enc` nem
`workspace_custom_values` (`kind='secret'`). Hoje não existe callback OAuth no servidor (a Meta troca `code` do
SDK JS).

## Escopo (faz)

- `packages/db/src/crypto.ts` (compatível com todo uso atual):
  - keyring: `ENCRYPTION_KEYS="1:<hex64>,2:<hex64>"` + `ENCRYPTION_KEY_CURRENT=<n>`; sem `ENCRYPTION_KEYS`,
    `ENCRYPTION_KEY` vale como versão 1; validação de 32 bytes por chave; erro claro de versão ausente;
  - `getKey(version)` passa a respeitar a versão (corrige o achado);
  - novo `encryptSecretV2(plaintext, { aad })` → `v2:<ver>:<iv>:<tag>:<ct>` com a versão corrente;
    `decryptSecretAny(payload, { aad? })` aceita v2 e o legado `iv:tag:ct` (versão 1, sem AAD);
  - `encryptSecret`/`decryptSecret` atuais continuam funcionando idênticos (teste de regressão com payload
    gerado antes da mudança).
- `packages/integrations/src/vault/` (exportado só por `@hm/integrations/server`):
  `sealCredential({ workspaceId, connectionId, kind, value })` e `openCredential(...)` com AAD
  `workspace_id:connection_id:kind`; `fingerprint(value)` = 4 últimos caracteres; tipos `CredentialMaterial`
  por `kind` (Zod: `oauth_tokens { accessToken, refreshToken?, expiresAt?, scope? }`, `api_key { key }`,
  `sql_dsn { host, port, database, user, password, options }`, `mcp_token { url, token }`).
- Regra de lint `no-restricted-imports` para `@hm/integrations/server` fora de: `apps/workers/src/integrations/**`,
  `apps/api/src/services/integrations/{credentials,oauth,test-run}.ts`. Registrar no `eslint.config.mjs`.
- `packages/integrations/src/oauth/`: `buildAuthorizeUrl` (PKCE S256, `state` aleatório 32 bytes),
  `exchangeCode`, `refreshTokens`, com endpoints vindos do manifesto (`auth.oauth: { authorizeUrl, tokenUrl,
  scopes, clientIdEnv, clientSecretEnv }`; acrescentar ao `ConnectorManifestSchema`), sempre por `ctx.fetch`
  guardado.
- API:
  - `apps/api/src/services/integrations/credentials.ts`: `POST /connections/:id/credentials` testa a credencial
    **em claro antes de gravar** (`connector.auth.test`), sela e grava; devolve `{ ok, fingerprint }`; nunca ecoa;
    auditoria via `recordIntegrationAudit` (S07);
  - `apps/api/src/services/integrations/oauth.ts` + `apps/api/src/routes/integrations/oauth.ts` (arquivo criado
    vazio pelo S07): `GET /connections/:id/oauth/start` (grava `integration_oauth_states` com `state_hash`,
    verificador PKCE selado, membro, expira em 10 min) e `GET /api/integrations/oauth/callback` (uso único por
    `update … where used_at is null and expires_at > now() returning`, confere o membro da sessão, troca o
    `code`, sela os tokens, redireciona para `/integracoes/<slug>/conectar?passo=2`); erros redirecionam com
    `?erro=<codigo>` sem detalhe sensível;
  - `apps/api/src/routes/integrations/credentials.ts` (criado vazio pelo S07): monta a rota de credencial.
- Workers: `apps/workers/src/integrations/reencrypt/`: job `integrations:reencrypt` (disparo manual por CLI
  `pnpm --filter @hm/workers reencrypt` e agendável) que, em lotes de 200 com `FOR UPDATE SKIP LOCKED`, recifra
  para a versão corrente: `integration_credentials`, `channel_secrets.*_enc`, `meta_connections.access_token_enc`,
  `outbound_webhooks.secret_enc`, `platform_secrets.value_enc`, `workspace_custom_values.value` (só
  `kind='secret'`), e imprime o relatório `tabela → total, recifradas, pendentes`. Idempotente.
  O registro do job no bootstrap dos workers fica com o S04 (dono de `apps/workers/src/integrations/index.ts`).
- `docs/runbooks/rotate-encryption-key.md` reescrito: keyring, ordem (adicionar v2 → `CURRENT=2` → recifrar →
  provar zero pendentes em todas as tabelas → remover v1), consultas de prova, rollback.
- `.env.example`: `ENCRYPTION_KEYS`, `ENCRYPTION_KEY_CURRENT` documentadas.

## Fora de escopo

- Usar a credencial para sincronizar (S04). UI do passo 1 (S10).

### files_allowed

- `packages/db/src/crypto.ts`
- `packages/db/src/crypto.test.ts`
- `packages/integrations/src/vault/**`
- `packages/integrations/src/oauth/**`
- `packages/integrations/src/core/manifest.ts`
- `packages/integrations/src/server.ts`
- `packages/shared/src/integrations/credentials.ts`
- `apps/api/src/services/integrations/credentials.ts`
- `apps/api/src/services/integrations/credentials.test.ts`
- `apps/api/src/services/integrations/oauth.ts`
- `apps/api/src/services/integrations/oauth.test.ts`
- `apps/api/src/routes/integrations/oauth.ts`
- `apps/api/src/routes/integrations/credentials.ts`
- `apps/workers/src/integrations/reencrypt/**`
- `apps/workers/package.json`
- `docs/runbooks/rotate-encryption-key.md`
- `.env.example`
- `eslint.config.mjs`

### files_forbidden

- `packages/db/src/schema/**`, `packages/db/drizzle/**` (S01)
- `apps/workers/src/integrations/index.ts`, `apps/workers/src/bootstrap/**` (S04)

## Definition of Done

- [ ] teste: payload legado gerado com o código antigo decifra igual depois da mudança
- [ ] teste: v2 cifrado com `aad` de uma conexão **não** decifra com `aad` de outra conexão/empresa
- [ ] teste: keyring com v1 e v2; `CURRENT=2` cifra em v2 e lê v1; versão ausente ⇒ erro claro
- [ ] teste: rota de credencial nunca devolve o valor; log do teste não contém o segredo (grep)
- [ ] teste OAuth: `state` reusado, expirado, de outro membro ou de outra conexão ⇒ recusado; PKCE S256 enviado
- [ ] teste: `reencrypt` em base de teste com linhas v1 em todas as 6 tabelas ⇒ zero pendentes; segunda execução
      não muda nada
- [ ] lint: importar `@hm/integrations/server` fora da lista falha
- [ ] runbook reescrito e revisado contra o código
- [ ] pedir `security-auditor` antes do merge (cripto e OAuth)

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/integrations typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
pnpm exec eslint packages/db/src/crypto.ts packages/integrations/src/vault packages/integrations/src/oauth apps/api/src/services/integrations apps/api/src/routes/integrations apps/workers/src/integrations/reencrypt
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/crypto.test.ts --maxWorkers=1
pnpm --filter @hm/integrations exec vitest run src/vault src/oauth --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/integrations --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/integrations/reencrypt --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. Revisão obrigatória do `security-auditor` (o S13 audita a fase inteira, mas cripto
  não espera o fim da fase).
- Não troque o formato dos outros `*_enc` sem o job: o job lê qualquer formato e escreve v2 **sem AAD** nas
  colunas legadas (o AAD só é obrigatório em `integration_credentials`, cujo AAD é conhecido). Documente isso no
  runbook.
