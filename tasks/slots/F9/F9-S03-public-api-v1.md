---
id: F9-S03
title: API pública v1 — send_message/template + upsert_contact + trigger_flow + conversations + OpenAPI/Swagger
phase: F9
status: review
priority: high
estimated_size: L
depends_on: [F9-S02]
agent_id: backend-engineer
claimed_at: 2026-06-11T21:38:54Z
completed_at: 2026-06-11T21:47:20Z

---
# F9-S03 — Public API v1

> **source_docs:** `docs/ARCHITECTURE.md` (API pública); `docs/features/LIVECHAT.md`/`FLOW_BUILDER.md` (serviços reusados); `docs/ROADMAP.md` F9-S02, F9-S03
> **blocks:** —

## Objetivo
Endpoints `/api/v1/*` gated por `requireApiKey` + scope: `POST send_message`, `POST send_template`, `POST upsert_contact`, `POST trigger_flow`, `GET conversations` (lista), `GET conversations/:id`. Cada um reusa o serviço existente (pipeline outbound, contacts service, flow-engine, conversations API) — sem reimplementar regra. Mais a spec **OpenAPI gerada dos schemas Zod** + Swagger UI em `/api/v1/docs`.

## Escopo (faz)
- `apps/api/src/routes/v1/**`: os 6 endpoints, cada um com schema Zod de request/response, `requireScope` adequado (`write:messages`, `write:contacts`, `write:flows`, `read:conversations`), e shape de resposta v1 estável (versionado).
- `apps/api/src/routes/v1/openapi.ts`: geração da spec OpenAPI 3.1 a partir dos schemas Zod (`@asteasolutions/zod-to-openapi` ou similar) + Swagger UI servida em `/api/v1/docs`.
- Reuso: send → publica `outbound.request` (F1-S07/S24); upsert_contact → contacts service (F8-S09); trigger_flow → `@hm/flow-engine`.triggerFlow (F4); conversations → query existente (F1-S12).

## Fora de escopo
- Auth/rate-limit (F9-S02), webhooks (F9-S05), management UI (F9-S06).

## Arquivos permitidos
- `apps/api/src/routes/v1/**`

## Permission scope
- Cada endpoint exige o scope correspondente na `api_key` (`requireScope`). Sem scope → 403. RLS por workspace da chave.

## Definition of Done
- [ ] 6 endpoints funcionam sob api-key + scope, reusando serviços (não duplicam lógica); respostas com shape v1 estável; erros padronizados.
- [ ] OpenAPI 3.1 gerada dos Zod + Swagger UI em `/api/v1/docs` lista todos os endpoints.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Router montado em app.ts pelo orchestrator. Slot L — se passar de ~500 linhas, separe os endpoints de escrita (send/upsert/trigger) dos de leitura+openapi. Versionar em `/v1` desde já (contrato estável p/ integradores).
