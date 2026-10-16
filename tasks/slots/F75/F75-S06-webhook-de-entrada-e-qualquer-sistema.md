---
id: F75-S06
title: Webhook de entrada por empresa e conector "Conectar qualquer sistema" com teste ao vivo
phase: F75
status: blocked
priority: high
estimated_size: M
model: opus
depends_on: [F75-S04, F75-S05, F73-S02]
blocks: [F75-S11, F75-S12, F75-S13]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
  - docs/decisions/ADR-005-conectores-cofre-e-loja-de-integracoes.md
agent_id: backend-engineer
---
# F75-S06 — Webhook de entrada e "Conectar qualquer sistema"

## Objetivo

Qualquer sistema que saiba chamar uma URL manda contatos, negócios e pedidos para o Leadium: a empresa recebe um
endereço e uma chave próprios, envia no formato canônico (ou no dela, com mapeamento), e vê no teste ao vivo o
evento chegando e o que ele criou.

## Contexto

Maquete B6 (endereço `…/in/arc_…`, chave `lk_live_…` no `Authorization`, formato `negocio.criar`, teste ao vivo,
eventos de teste apagados em 24 h). Spec §4.4, ADR-005 §6, ameaças T2/T6.

## Escopo (faz)

- `packages/integrations/src/connectors/generic-webhook/`: implementação do conector `generic-webhook` (o
  manifesto já existe no catálogo do S02): `webhook.verify` (Bearer contra `sha256`, e o anterior até
  `prev_valid_until`; HMAC opcional com `verifyWebhookSignature` de `@hm/shared`, tolerância 300 s, exigível por
  conexão), `webhook.normalize` para `contato.upsert`, `negocio.criar`, `negocio.atualizar`, `pedido.upsert`
  (Zod do formato canônico em `packages/shared/src/integrations/inbound.ts`), `detectError`, `sample` (últimos
  5 eventos recebidos) e `runConformance` no teste. Registrar no registro de conectores.
- Router público `apps/api/src/routes/integrations-inbound/index.ts` (criado vazio pelo S07, montado antes do
  `express.json`): `POST /in/:endpointKey`:
  - corpo cru ≤ 256 KB (`413`), `application/json` (`415`), profundidade ≤ 32;
  - lookup por `integration_endpoint_lookup` (S01); chave errada, endpoint inexistente ou desativado ⇒ `401`
    **uniforme** (mesmo corpo e tempo aproximado; comparação em tempo constante);
  - rate limit Redis 120/min por endpoint e 600/min por workspace (`429` com `Retry-After`);
  - idempotência: `Idempotency-Key` ou `sha256(corpo)`; repetido ⇒ `200 { id, duplicate: true }`;
  - grava em `integration_inbound_events` dentro de `withWorkspace` e enfileira job na mesma transação pela
    outbox (`hm.q.integrations.inbound`) ⇒ `202 { id }`.
- Worker `apps/workers/src/integrations/inbound/`: consome, normaliza, aplica mapeamento (formato canônico
  dispensa; formato próprio usa `applyMapping` do S05), passa por `upsertByExternalRef` (S04), grava `result`
  (o que criou/atualizou) e publica `integration:event` no socket da sala `ws:<workspaceId>` (registrar em
  `packages/shared/src/socket-events.ts`); falhas viram `syncErrorsRepo.upsertGrouped`. Registrar em
  `apps/workers/src/integrations/index.ts`.
- Retenção: job diário apaga eventos com mais de 30 dias e, a cada hora, os de teste com mais de 24 h **e as
  entidades criadas por eles** (refs com `is_test=true`).
- API de administração `apps/api/src/routes/integrations/inbound-admin.ts` (criado vazio pelo S07) +
  `apps/api/src/services/integrations/inbound.ts`, todas `integration.manage`:
  - `POST /api/integrations/connections/:id/inbound` cria o endpoint (`arc_` + 22 base62) e devolve a chave
    **uma vez** (`Cache-Control: no-store`);
  - `POST …/inbound/rotate-secret` (anterior vale 24 h), `POST …/inbound/require-signature { on }`,
    `POST …/inbound/test-event` (injeta `negocio.criar` de exemplo com `is_test=true`), `GET …/inbound/events`
    (últimos 20, sem payload completo: tipo, quando, status, resumo do que criou).

## Fora de escopo

- UI B6 (S11). Webhooks de saída (já existem).

### files_allowed

- `packages/integrations/src/connectors/generic-webhook/**`
- `packages/integrations/src/connectors/index.ts`
- `packages/shared/src/integrations/inbound.ts`
- `packages/shared/src/socket-events.ts`
- `apps/api/src/routes/integrations-inbound/**`
- `apps/api/src/routes/integrations/inbound-admin.ts`
- `apps/api/src/services/integrations/inbound.ts`
- `apps/api/src/services/integrations/inbound.test.ts`
- `apps/workers/src/integrations/inbound/**`
- `apps/workers/src/integrations/index.ts`

## Definition of Done

- [ ] teste: chave errada, endpoint inexistente e desativado ⇒ mesmo `401` (corpo idêntico)
- [ ] teste: endpoint da empresa A nunca grava na B (dois workspaces, chave trocada)
- [ ] teste: replay com o mesmo `Idempotency-Key` ⇒ uma entidade só
- [ ] teste: HMAC exigido sem assinatura ⇒ 401; timestamp fora de 300 s ⇒ 401
- [ ] teste: 257 KB ⇒ 413; `text/plain` ⇒ 415; 121ª req/min ⇒ 429
- [ ] teste: rotação — chave antiga funciona por 24 h e depois não
- [ ] teste: evento de teste cria contato+negócio marcados e o job apaga em 24 h (relógio injetado)
- [ ] teste: `integration:event` emitido para a sala certa
- [ ] chave em claro nunca logada (grep)

## Validação

```bash
pnpm --filter @hm/integrations typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/integrations exec vitest run src/connectors/generic-webhook --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/integrations-inbound src/services/integrations/inbound.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/integrations/inbound --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. Revisão do `security-auditor` antes do merge (endpoint público).
- Nginx/host `hooks.leadium.com.br` é infraestrutura: registrar em `tasks/COMMS.md` para o deploy; o handler
  responde no host da API em `/in/:endpointKey`.
