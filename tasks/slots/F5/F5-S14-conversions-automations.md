---
id: F5-S14
title: Conversões automações — flow handler register_conversion + tag pg-trigger + fecha F2-S20
phase: F5
status: review
priority: medium
estimated_size: M
depends_on: [F5-S03, F5-S06, F5-S12]
agent_id: backend-engineer
claimed_at: 2026-06-10T22:24:47Z
completed_at: 2026-06-10T22:27:49Z

---
# F5-S14 — Conversões automações

> **source_docs:** `docs/DATA_MODEL.md` §10.7 (hooks); `docs/features/DASHBOARD.md` §13; `docs/ROADMAP.md` F5-S15
> **blocks:** —

## Objetivo
Registro automático de conversões por três caminhos: (1) regra de stage automation `register_conversion` (via handler do flow-engine); (2) trigger Postgres em `contact_tags` insert que consulta `conversion_tag_triggers`; (3) **fechar o stub de F2-S20** (`register_conversion` workflow tool que respondia "não suportado até F5") apontando para a API real (F5-S12).

## Escopo (faz)
- `packages/flow-engine/src/handlers/register_conversion.handler.ts`: handler que registra via a API/serviço de conversões (F5-S12), respeitando `workspace_agent_policies.allow_agent_conversions` quando origem agente.
- Migration de **trigger Postgres** em `contact_tags` (AFTER INSERT) que, consultando `conversion_tag_triggers`, insere `conversion_events(source='tag_added')` com dedup.
- Fechar o handler `register_conversion` de F2-S20 (Node) para chamar a API de F5-S12 em vez do stub.

## Fora de escopo
- Schema conversões (F5-S03), API (F5-S12), UI (F5-S13), automation engine base (F5-S06 — aqui só o action register_conversion).

## Arquivos permitidos
- `packages/flow-engine/src/handlers/register_conversion.handler.ts`
- `packages/db/drizzle/**` (migration do trigger)
- `apps/api/src/routes/agents/tools/register_conversion.ts` (ou o arquivo do stub de F2-S20 — confirmar path no claim)

## Definition of Done
- [ ] Regra de stage `register_conversion` cria conversão; trigger de tag cria conversão (com dedup same-day respeitado).
- [ ] Stub de F2-S20 fechado: a tool registra de verdade (respeitando `allow_agent_conversions`).
- [ ] `pnpm --filter @hm/flow-engine test` + `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Confirme no claim o path exato do handler `register_conversion` de F2-S20 (memória [[tagix-f2-progress]]). O trigger pg em contact_tags deve respeitar RLS/workspace ao inserir o event.
