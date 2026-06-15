---
id: F31-S05
title: Inspector http_request completo (headers/body/retry/map-resposta)
phase: F31
status: in-progress
priority: medium
estimated_size: M
depends_on: [F31-S03]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T13:09:22Z

---
# F31-S05 — Inspector http_request completo

## Objetivo

O node `http_request` passa a configurar **headers**, **body**, **retry** e **mapeamento da resposta** (JSONPath → variável), alimentando os edges `success`/`error` já existentes.

## Contexto

Hoje só method+url. Não é node de saída (não envia mensagem) → não depende do bridge, só da infra de variáveis (S03) para o map-resposta.

## Escopo (faz)

- `apps/web/features/flow-builder/nodes/http_request/**` — editor de headers (k/v), body (com interpolação de variáveis), política de retry, e mapeamento resposta→variável via JSONPath; validação Zod.
- `packages/flow-engine/src/handlers/http_request.handler.ts` — suportar headers/body/retry/map se ainda não cobertos; gravar variáveis mapeadas no contexto.

## Fora de escopo

- Infra de variáveis (S03), outros inspectors.

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/http_request/**`
- `packages/flow-engine/src/handlers/http_request.handler.ts`

## Arquivos proibidos

- `helpers-context.tsx`, `VariablesPicker.tsx`, `InspectorPanel.tsx`, `registry.ts`, `node-catalog.ts`.

## Definition of Done

- [ ] Headers/body/retry configuráveis; resposta mapeada para variável usável a jusante.
- [ ] Edges success/error roteiam por status/erro.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## UX considerations

- `UX_PRINCIPLES`: editor k/v estruturado; preview/validação do JSONPath; sem id/credencial em texto cru exposto em log.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/web test
```

## Notas

- Cuidado com SSRF: o handler http já deve ter allowlist/timeout — preservar. Relacionado: [[tagix-flow-builder-v2-survey]].
