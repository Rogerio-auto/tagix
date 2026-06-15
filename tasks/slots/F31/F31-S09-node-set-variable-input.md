---
id: F31-S09
title: Nodes set_variable + input (variáveis & captura validada)
phase: F31
status: in-progress
priority: medium
estimated_size: M
depends_on: [F31-S08, F31-S01]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T19:51:10Z

---
# F31-S09 — Nodes set_variable + input

## Objetivo

Dois nodes novos: `set_variable` (escreve variável no contexto) e `input`/question (envia pergunta + captura resposta tipada com validação e retry).

## Contexto

Hoje só `http_request` grava variável (`webhook_response`). `input` é um wait-for-response com validação — envia a pergunta (depende do bridge S01) e roteia por sucesso/timeout. Stubs criados em S08.

## Escopo (faz)

- `packages/flow-engine/src/handlers/set_variable.handler.ts` — grava variável (nome + valor com interpolação) no contexto.
- `packages/flow-engine/src/handlers/input.handler.ts` — envia prompt, aguarda resposta, valida por tipo (texto/email/telefone/número/data), retry com mensagem de erro, grava na variável.
- `apps/web/features/flow-builder/nodes/set_variable/**` + `nodes/input/**` — inspectors reais (usam VariablesPicker/pickers de S03).

## Fora de escopo

- Espinha/registry/catálogo (S08). Outros novos nodes (S10/S11).

## Arquivos permitidos

- `packages/flow-engine/src/handlers/set_variable.handler.ts`
- `packages/flow-engine/src/handlers/input.handler.ts`
- `apps/web/features/flow-builder/nodes/set_variable/**`
- `apps/web/features/flow-builder/nodes/input/**`

## Arquivos proibidos

- `registry.ts`, `validation.ts`, `node-catalog.ts`, `nodeTypes.ts`, `nodeInspectors.ts`.

## Definition of Done

- [ ] set_variable grava e a variável é usável a jusante.
- [ ] input valida tipo, faz retry e roteia resposta/timeout.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## UX considerations

- `UX_PRINCIPLES`: variável via picker; tipos de validação claros; preview do prompt.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/web test
```

## Notas

Relacionado: [[tagix-flow-builder-v2-survey]].
