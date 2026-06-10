---
id: F4-S11
title: Frontend node components (15 tipos) — node render + inspector + metadata, 1 pasta por tipo
phase: F4
status: in-progress
priority: high
estimated_size: L
depends_on: [F4-S10]
agent_id: backend-engineer
claimed_at: 2026-06-10T21:16:27Z

---
# F4-S11 — Node components (web)

> **source_docs:** `docs/features/FLOW_BUILDER.md` §4.1, §9.2; `docs/UX_PRINCIPLES.md` §3; `docs/ROADMAP.md` F4-S12
> **blocks:** —

## Objetivo
Implementar (substituindo os stubs de F4-S10) os 15 node types do canvas — 1 pasta por tipo com `<Tipo>Node.tsx` (render no canvas), `<Tipo>Inspector.tsx` (form de config, com `VariablesPicker` onde cabe) e `metadata.ts` (label/color/icon/edge handles). Cada node valida sua `data` com o mesmo Zod do handler correspondente.

## Escopo (faz)
- `apps/web/features/flow-builder/nodes/<tipo>/**` para os 15 tipos: trigger, message, interactive, meta_flow, wait, wait_for_response, condition, switch, ai_action, change_status, http_request, external_notify, move_stage, add_tag, remove_tag.
- Os 3 bloqueados por F5 (`move_stage`/`add_tag`/`remove_tag`) renderizam normalmente mas o Inspector mostra um aviso "ativa na F5" (sem CTA falso), coerente com o stub-guard do handler.

## Fora de escopo
- Canvas/palette/inspector shell + nodeTypes registry (F4-S10, dono), handlers (F4-S02/04/05/06).

## Arquivos permitidos
- `apps/web/features/flow-builder/nodes/**`

## Arquivos proibidos
- `apps/web/features/flow-builder/canvas/**` (dono: F4-S10, incl. o `nodeTypes` registry)

## Definition of Done
- [ ] Os 15 nodes renderizam no canvas com edge handles corretos (ex.: condition true/false; wait_for_response response/timeout; http_request success/error; switch dynamic).
- [ ] Inspector de cada node edita a `data` com validação; nodes bloqueados-F5 sinalizam claramente.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §3 nodes legíveis (ícone+label+resumo da config), edge handles nomeados e óbvios; estados selected/error; sem texto sobreposto; tokens DS v2 (zero hex).
- Inspector com `VariablesPicker` para inputs interpoláveis ({{contact.name}} etc.).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Slot grande (15 nodes) — se passar de ~500 linhas úteis, peça ao orchestrator pra dividir em 2 (output/logic vs system/external) seguindo o mesmo files_allowed por pasta.
