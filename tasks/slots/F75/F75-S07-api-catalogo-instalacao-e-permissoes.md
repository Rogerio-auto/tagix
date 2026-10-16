---
id: F75-S07
title: API da Loja — catálogo, conexões, rascunho do assistente, ativação, pedidos, permissões e plano
phase: F75
status: blocked
priority: critical
estimated_size: M
model: opus
depends_on: [F75-S01, F75-S02, F73-S02]
blocks: [F75-S03, F75-S05, F75-S08, F75-S09]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
  - docs/design/copilot-integracoes-ux.md
  - docs/features/PERMISSIONS.md
agent_id: backend-engineer
---
# F75-S07 — API de catálogo, instalação e estado

## Objetivo

A Loja tem API: catálogo com busca por intenção e estado por empresa ("Suas integrações" primeiro, Atenção com
causa), detalhe da integração, criação de conexão em rascunho com progresso salvo por passo, ativação no passo 5,
pedido de integração e "Avise-me". Com as permissões `integration.*`, o primeiro gate de plano aplicado no produto
e auditoria.

## Contexto

Spec §6 (contratos), §7 (permissões e plano), maquete B1, B2, B5. Este slot também cria o **esqueleto de rotas**
da F75 para que os slots seguintes trabalhem em arquivos próprios, em paralelo.

## Escopo (faz)

- `packages/shared/src/permissions.ts`: `integration.view` (`ALL`), `integration.request` (`STAFF`),
  `integration.operate` (`MANAGERS`), `integration.manage` (`ADMINS`), com comentário apontando a spec §7.
- `apps/api/src/services/integrations/entitlements.ts`: `requireFeature(key)` (middleware) e
  `checkFeature(entitlements, key)`: feature ausente no plano ⇒ desligada; plano sem objeto `features` (legado)
  ⇒ ligada; `max_integrations` conta conexões `status <> 'disconnected'` e não `draft`. `402 { error:
  'plan_required', feature, planLabel }`. Assinatura somente leitura (F71-S06) ⇒ escrita `402 read_only`.
- `apps/api/src/services/integrations/audit.ts`: `recordIntegrationAudit(tx, req, { action, connectionId,
  metadata })` gravando em `audit_logs` com `resource_type='integration_connection'`; ações:
  `integration.connected`, `credential.set`, `mapping.changed`, `write_direction.enabled`, `paused`, `resumed`,
  `reprocessed`, `disconnected`, `inbound_secret.rotated`, `requested`. `metadata` nunca leva segredo.
- `apps/api/src/services/integrations/catalog.ts`: junta `listManifests()` com as conexões da empresa e calcula
  `state` (`connect|connected|attention|soon|locked`) e `note` ("Sincronizou há 4 min · 3 erros", "A chave expirou
  há 2 dias"); busca por intenção: normaliza sem acento e casa em `name`, `summary`, `keywords`, nomes de
  entidade (`estoque`, `boleto`, `nota fiscal`); ordena "Suas integrações" com `attention` primeiro.
- `apps/api/src/services/integrations/connections.ts`: criar rascunho (ou devolver o existente), validar passo do
  assistente (`blockers`: campo obrigatório sem mapeamento, credencial ausente, entidade nenhuma ligada),
  ativar (passo 5: tudo válido; direção `push` exige `confirmWrite: true` e audita `write_direction.enabled`;
  grava `next_run_at = now()` para o scheduler do S04 pegar), detalhe sem segredo.
- Rotas (Zod estrito, schemas em `packages/shared/src/integrations/{catalog,connections,requests}.ts`):
  `GET /api/integrations/catalog`, `GET /api/integrations/catalog/:connectorId`,
  `POST /api/integrations/connections`, `GET /api/integrations/connections/:id`,
  `PATCH /api/integrations/connections/:id/wizard`, `POST /api/integrations/connections/:id/activate`,
  `POST /api/integrations/requests` (devolve `sameRequestCount` via `integration_request_count`),
  `POST /api/integrations/catalog/:connectorId/interest`. Rate limit: pedidos 10/h por membro.
- **Esqueleto de roteamento** (para paralelismo):
  - `apps/api/src/routes/integrations/index.ts` monta os routers `catalog`, `connections`, `requests` (deste
    slot) e cria **vazios** (só `Router()` exportado e um comentário com o slot dono) e já montados:
    `oauth.ts` e `credentials.ts` (S03), `mapping.ts` (S05), `test-run.ts` (S04), `inbound-admin.ts` (S06),
    `health.ts` (S08), `uploads.ts` (S12);
  - `apps/api/src/routes/integrations-inbound/index.ts`: router público vazio (dono: S06), montado em
    `apps/api/src/app.ts` **junto do router de webhooks, antes do `express.json`** (corpo cru para HMAC);
  - `apps/api/src/app.ts`: monta os dois routers.
- Testes de rota com supertest + integração com banco: permissões por papel, RLS entre duas empresas, gate de
  plano, busca por intenção, ordenação de Atenção, ativação bloqueada por `blockers`, `push` sem `confirmWrite`.

## Fora de escopo

- Credenciais e OAuth (S03), mapeamento (S05), teste com 5 registros (S04), saúde (S08), webhook de entrada (S06),
  UI (S09).

### files_allowed

- `packages/shared/src/permissions.ts`
- `packages/shared/src/integrations/catalog.ts`
- `packages/shared/src/integrations/connections.ts`
- `packages/shared/src/integrations/requests.ts`
- `apps/api/src/services/integrations/entitlements.ts`
- `apps/api/src/services/integrations/entitlements.test.ts`
- `apps/api/src/services/integrations/audit.ts`
- `apps/api/src/services/integrations/catalog.ts`
- `apps/api/src/services/integrations/catalog.test.ts`
- `apps/api/src/services/integrations/connections.ts`
- `apps/api/src/services/integrations/connections.test.ts`
- `apps/api/src/routes/integrations/index.ts`
- `apps/api/src/routes/integrations/catalog.ts`
- `apps/api/src/routes/integrations/connections.ts`
- `apps/api/src/routes/integrations/requests.ts`
- `apps/api/src/routes/integrations/routes.integration.test.ts`
- `apps/api/src/routes/integrations/oauth.ts`
- `apps/api/src/routes/integrations/credentials.ts`
- `apps/api/src/routes/integrations/mapping.ts`
- `apps/api/src/routes/integrations/test-run.ts`
- `apps/api/src/routes/integrations/inbound-admin.ts`
- `apps/api/src/routes/integrations/health.ts`
- `apps/api/src/routes/integrations/uploads.ts`
- `apps/api/src/routes/integrations-inbound/index.ts`
- `apps/api/src/app.ts`

### files_forbidden

- `packages/db/**`, `apps/web/**`, `apps/workers/**`

## Definition of Done

- [ ] `integration.*` em `ROLE_CAN` com teste de matriz (READONLY vê, não pede; AGENT pede; SUPERVISOR opera;
      ADMIN gerencia)
- [ ] teste: empresa sem `features.integrations` ⇒ card `locked` e `POST /connections` 402; plano legado sem
      `features` ⇒ liberado
- [ ] teste: busca "estoque", "boleto", "contábil" (sem resultado) devolve o esperado
- [ ] teste: conexão em Atenção aparece primeiro em "Suas integrações" com a causa em `note`
- [ ] teste: rascunho salvo por passo e reaberto no mesmo passo; ativar com `blockers` ⇒ 409 com a lista
- [ ] teste: `push` sem `confirmWrite` ⇒ 400; com ⇒ ativa e audita
- [ ] teste: RLS — empresa A não lê nem ativa conexão da B
- [ ] auditoria em todas as ações de escrita; `metadata` sem segredo
- [ ] routers vazios montados e documentados com o slot dono

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/api typecheck
pnpm exec eslint packages/shared/src/permissions.ts packages/shared/src/integrations apps/api/src/services/integrations apps/api/src/routes/integrations apps/api/src/routes/integrations-inbound apps/api/src/app.ts
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/integrations src/routes/integrations --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. `permissions.ts` é arquivo disputado (a F73 pode acrescentar `copilot.*`): se
  houver slot da F73 aberto nele, sequenciar pelo `plan-batch` e registrar em `tasks/COMMS.md`.
- O `app.ts` só ganha duas montagens; nada mais.
