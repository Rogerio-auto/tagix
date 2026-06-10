---
id: F4-S07
title: Validação pré-publish — Zod + cycle detection + unreachable nodes + variable refs
phase: F4
status: done
priority: high
estimated_size: S
depends_on: [F4-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:30:17Z
completed_at: 2026-06-10T20:31:32Z

---
# F4-S07 — Validação de flow (pré-publish)

> **source_docs:** `docs/features/FLOW_BUILDER.md` §9.3, §12; `docs/ROADMAP.md` F4-S13
> **blocks:** F4-S08, F4-S10

## Objetivo
Implementar `validateFlow(nodes, edges)` (substituindo o stub de F4-S02) em `@hm/flow-engine`: exatamente 1 `trigger`, detecção de nodes inalcançáveis (BFS a partir do trigger), detecção de ciclos, e referências a variáveis desconhecidas (`{{var}}`). Retorna issues estruturadas. Reusado pela API (publish, F4-S08) e pelo frontend (banner, F4-S10).

## Escopo (faz)
- `packages/flow-engine/src/validation.ts`: `validateFlow` (superRefine §9.3) + helpers `computeReachable`, `hasCycle`, `extractVarReferences`, `isKnownVar` (escopo de vars do §8).
- Exportar em `index.ts`... **não** — o export já é declarado por F4-S02 (stub). Este slot só preenche `validation.ts`.

## Fora de escopo
- API/UI que consomem (F4-S08/S10), engine core (F4-S02).

## Arquivos permitidos
- `packages/flow-engine/src/validation.ts`

## Arquivos proibidos
- `packages/flow-engine/src/index.ts` (dono: F4-S02 — já exporta `validation`)

## Contratos de saída
- `validateFlow(input) -> { ok: boolean; issues: { code, message, nodeId? }[] }` — contrato consumido por F4-S08 (publish) e F4-S10 (banner client-side).

## Definition of Done
- [ ] Detecta: ≠1 trigger, nodes inalcançáveis, ciclos, e `{{vars}}` desconhecidas — com testes cobrindo cada caso.
- [ ] Determinística e pura (sem I/O) — roda igual no servidor e no browser.
- [ ] `pnpm --filter @hm/flow-engine test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Função pura é o que permite reuso server+client — não importe `@hm/db` aqui.
