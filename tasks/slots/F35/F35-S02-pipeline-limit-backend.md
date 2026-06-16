---
id: F35-S02
title: Limite máximo de pipelines por workspace (backend)
phase: F35
status: review
priority: high
estimated_size: XS
depends_on: []
blocks: []
source_docs:
  - docs/features/PIPELINE.md
agent_id: backend-engineer
claimed_at: 2026-06-16T13:24:20Z
completed_at: 2026-06-16T13:31:28Z

---
# F35-S02 — Limite de pipelines no backend

## Objetivo

Enforçar um limite máximo de pipelines por workspace no endpoint `POST /api/pipelines`, retornando `422` com código `pipeline_limit_reached` quando excedido. Limite padrão: **10 pipelines** por workspace (configurável via entitlement override se existir).

## Contexto

Hoje `POST /api/pipelines` não tem limite — um workspace poderia criar centenas. O schema de entitlements (`workspace_entitlement_overrides`) já existe e permite sobrescrever limites por workspace, mas não tem campo `max_pipelines`. A implementação usa um default hardcoded de 10 com leitura opcional do override — pronto para escalar sem migration.

## Escopo (faz)

- **`apps/api/src/routes/pipeline/pipelines.ts`** — no handler `POST /api/pipelines`:
  1. Antes de inserir, contar `SELECT count(*) FROM pipelines WHERE workspace_id = $workspaceId`.
  2. Ler `max_pipelines` do entitlement override do workspace (se existir); fallback = `10`.
  3. Se `count >= limit` → `res.status(422).json({ error: 'pipeline_limit_reached', current: count, max: limit })`.
  4. Se dentro do limite → prosseguir com insert normal.

- Expor o limite no `GET /api/pipelines` response (adicionar `meta: { limit, current }` ao body) para que o frontend saiba exibir o contador antes de tentar criar.

## Fora de escopo

- UI de limite (S01 e S03)
- Adicionar campo `max_pipelines` na tabela de entitlements (schema já suporta via JSONB override — não precisa de migration)
- Limitar stages por pipeline (escopo diferente)

## Arquivos permitidos

- `apps/api/src/routes/pipeline/pipelines.ts`
- `apps/api/src/routes/pipeline/pipelines.test.ts` (ou criar se não existir)

## Arquivos proibidos

- `packages/db/**` (sem migration nova)
- `apps/web/**`

## Definition of Done

- [ ] `POST /api/pipelines` retorna `422 { error: 'pipeline_limit_reached', current: N, max: 10 }` quando workspace tem >= 10 pipelines.
- [ ] `GET /api/pipelines` retorna `{ data: [...], meta: { limit: 10, current: N } }`.
- [ ] Workspace com override `max_pipelines: 3` respeita o override.
- [ ] Teste unitário cobre: (a) abaixo do limite → 201; (b) no limite → 422 com body correto.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test -- --run pipelines
```

## Notas

Para ler o entitlement override: fazer `SELECT overrides FROM workspace_entitlement_overrides WHERE workspace_id = $id` dentro da mesma transação RLS. Se a linha não existir ou `overrides.max_pipelines` for nulo, usar `10`. Sem Zod extra — cast simples `Number(overrides?.max_pipelines) || 10`.

O `GET /api/pipelines` atualmente retorna `pipeline[]` diretamente. Para não quebrar clientes existentes, adicionar `meta` como campo novo ao lado do array: `{ data: pipeline[], meta: { limit, current } }`. O frontend atual (`usePipelines`) precisará ser ajustado para ler `data` em vez do array direto — comunicar essa quebra ao S01.
