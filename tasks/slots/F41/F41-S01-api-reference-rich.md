---
id: F41-S01
title: Referência por endpoint — request body + params + response + exemplo gerado
phase: F41
status: done
priority: high
estimated_size: M
depends_on: []
blocks:
  - F41-S02
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-19T15:51:20Z
completed_at: 2026-06-19T16:03:45Z

---
# F41-S01 — Referência rica por endpoint

## Objetivo

Enriquecer a referência da Leadium API (hoje só método+path+summary+scope) com **request body** (campos, tipos, obrigatórios), **parâmetros** (path/query), **response** (schema) e um **exemplo de requisição gerado do schema** (curl/JS/Python) por endpoint. Substituir o `snippets.ts` hardcoded por um gerador. Tudo derivado do OpenAPI live — sem listas manuais. (Spec: SUPPORT.md §6.1.)

## Contexto

- `apps/web/features/developers/openapi.ts` já carrega `/api/v1/openapi.json` e modela um subconjunto (`requestBody`/`responses` parcial). Precisa expandir: resolver `$ref` → `components.schemas`, extrair propriedades/required do body, parâmetros, e o schema de response.
- `apps/web/features/developers/ApiReference.tsx` renderiza só a linha resumo. `snippets.ts` tem exemplos genéricos hardcoded (só conversões).
- O documento OpenAPI 3.1 inclui `components.schemas` (Zod via zod-to-openapi). Confirmar que os bodies vêm como `$ref` e resolver.

## Escopo (faz)

- **`apps/web/features/developers/openapi.ts`** — estender o model + helpers: resolver `$ref`, extrair `requestBody` (propriedades, tipos, required, exemplo), `parameters` (path/query), `responses[2xx].schema`. Sem `any` (use `unknown` + narrowing).
- **`apps/web/features/developers/snippets.ts`** — trocar strings hardcoded por um **gerador** `buildExample(endpoint, lang)` que monta curl/JS/Python a partir do método/path/params/body-schema (valores de exemplo do schema ou placeholders tipados).
- **`apps/web/features/developers/ApiReference.tsx`** — endpoint expansível → painel de detalhe (body table, params, response schema, exemplo por linguagem reusando `CodeBlock`).
- Se um detalhe necessário NÃO estiver no spec (ex.: body não registrado), registrar em `tasks/COMMS.md` e abrir sub-slot de backend — NÃO hardcodar.

## Fora de escopo

- Console "Try it" / execução (S02). Backend/OpenAPI gen.

## Arquivos permitidos

- `apps/web/features/developers/openapi.ts`
- `apps/web/features/developers/snippets.ts`
- `apps/web/features/developers/ApiReference.tsx`
- `apps/web/features/developers/CodeBlock.tsx`

## Arquivos proibidos

- `apps/api/**`, `packages/**`, demais features

## Definition of Done

- [ ] Cada endpoint mostra body (campos/tipos/required), params e response, com `$ref` resolvido.
- [ ] Exemplo curl/JS/Python gerado do schema (não hardcoded) por endpoint.
- [ ] DS v2 tokens; estados loading/error; sem `any`.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

Branding "Leadium API". O gerador de exemplo (`buildExample`) é reusado pelo console no S02 — projete a API dele pensando nisso (recebe endpoint + valores e devolve a string por linguagem).
</content>
