---
id: F58-S04
title: Sincronizar, criar e acompanhar modelos pela API
phase: F58
status: review
priority: critical
estimated_size: M
depends_on: [F58-S03]
blocks: [F58-S05, F58-S06]
agent_id: agent-f58-s04
source_docs:
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-08-11T14:45:51Z
completed_at: 2026-08-11T15:05:37Z

---
# F58-S04 — Sincronizar, criar e acompanhar modelos pela API

## Objetivo

Expor o catálogo de modelos do WhatsApp para a aplicação, com sincronização
manual, criação para aprovação e atualização automática de status.

## Escopo

### files_allowed

- `apps/api/src/routes/channels/templates/**`
- `apps/api/src/routes/channels/index.ts`
- `apps/api/src/routes/channels/templates*.test.ts`
- `apps/api/src/routes/webhooks/**`
- `packages/shared/src/permissions.ts`
- `docs/features/PERMISSIONS.md`

### files_forbidden

- `apps/web/**`
- `apps/workers/src/campaigns/**`

## Definition of Done

- [ ] `GET /api/channels/:id/message-templates` lista com filtros de status, categoria, idioma e busca.
- [ ] `POST .../sync` atualiza o catálogo por upsert e devolve resumo criado/atualizado/arquivado.
- [ ] `POST .../message-templates` envia para aprovação e persiste o estado retornado.
- [ ] Apenas canal ativo `meta_whatsapp` é aceito; demais retornam motivo claro e acionável.
- [ ] Webhook de mudança de status atualiza o catálogo idempotentemente; reconciliação manual continua disponível.
- [ ] Evento de status por `waba_id` atualiza todos os canais ativos associados, sem cruzar workspaces.
- [ ] Permissões distinguem visualizar de gerenciar modelos e são testadas.
- [ ] Toda mutação de tenant usa RLS e nunca devolve credenciais do canal; o webhook só usa lookup privilegiado para descobrir os workspaces pelo `waba_id`.

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/shared test
```

## Notas

- Se o payload de webhook não oferecer todos os campos, marcar o catálogo como `stale` e manter a sincronização manual disponível. Job durável de reconciliação fica fora deste slot.
