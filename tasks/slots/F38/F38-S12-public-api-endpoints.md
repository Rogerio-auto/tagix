---
id: F38-S12
title: Novos endpoints API pública v1 + OpenAPI + scopes + testes
phase: F38
status: available
priority: high
estimated_size: L
depends_on: []
blocks:
  - F38-S13
source_docs:
  - docs/features/SUPPORT.md
agent_id: backend-engineer
---
# F38-S12 — Novos endpoints API pública v1

## Objetivo

Expandir a API pública v1 com os recursos aprovados (contacts, send_media, deals, conversions, flows, events), todos reusando serviços/repos existentes. Cada endpoint: Zod + rota + registro OpenAPI + scope + paginação consistente + teste. Alimenta o Portal do Desenvolvedor (S13).

## Contexto

A API v1 vive em `apps/api/src/routes/v1/` — `schemas.ts` (Zod + registry zod-to-openapi), `index.ts` (rotas), `openapi.ts` (paths), `routes.test.ts`. Auth por API key + scope (`API_SCOPES`), rate limit por chave. Endpoints atuais: send_message, send_template, upsert_contact, trigger_flow, list_conversations, get_conversation. Seguir exatamente o mesmo padrão (mesmos error responses 400/401/403/404/429, security `ApiKeyAuth`).

## Escopo (faz) — conforme SUPPORT.md §3.1

- `GET /api/v1/contacts` (`contacts:read`), `GET /api/v1/contacts/:id` (`contacts:read`)
- `POST /api/v1/messages/media` (`messages:write`)
- `GET /api/v1/deals` (`deals:read`), `GET /api/v1/deals/:id` (`deals:read`), `POST /api/v1/deals/:id/move` (`deals:write`)
- `POST /api/v1/conversions` (`conversions:write`), `GET /api/v1/conversions` (`conversions:read`)
- `GET /api/v1/flows` (`flows:read`)
- `GET /api/v1/events` (`calendar:read`), `POST /api/v1/events` (`calendar:write`)

Tudo em: `apps/api/src/routes/v1/schemas.ts` (Zod + scopes novos em `API_SCOPES`), `index.ts` (handlers reusando repos/serviços existentes de contacts/pipeline/conversions/flows/calendar), `openapi.ts` (registrar paths), `routes.test.ts` (cada endpoint: feliz path + scope insuficiente 403 + tenant isolation).

## Fora de escopo

- Lógica de negócio nova (só superfície de API sobre o que já existe). Portal UI (S13). Webhooks (já existem).

## Arquivos permitidos

- `apps/api/src/routes/v1/schemas.ts`
- `apps/api/src/routes/v1/index.ts`
- `apps/api/src/routes/v1/openapi.ts`
- `apps/api/src/routes/v1/routes.test.ts`

## Arquivos proibidos

- `apps/web/**`, `packages/db/**`, `apps/api/src/routes/!(v1)/**`

## Definition of Done

- [ ] Todos os endpoints implementados reusando serviços existentes; paginação consistente com v1.
- [ ] Novos scopes em `API_SCOPES`; 403 quando a chave não tem o scope.
- [ ] OpenAPI regenerado inclui os paths (visível em `/api/v1/docs`); título = "Leadium API".
- [ ] Tenant isolation testado; `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Notas

Não inventar campos: mapear 1:1 com os repos/serviços existentes. Se algum recurso (ex.: deals/events) não tiver serviço reusável limpo, registrar em COMMS.md e cortar o endpoint em vez de duplicar lógica. Trocar o título do OpenAPI para **Leadium API** aqui (único ponto product-facing de "Tagix" no código).
</content>
