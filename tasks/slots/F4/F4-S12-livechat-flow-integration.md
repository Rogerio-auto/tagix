---
id: F4-S12
title: LiveChat flow integration — quickbar manual + confirm modal + ExecutionsBadge
phase: F4
status: in-progress
priority: medium
estimated_size: M
depends_on: [F4-S08]
agent_id: backend-engineer
claimed_at: 2026-06-10T21:11:11Z

---
# F4-S12 — Integração Flow no LiveChat (web)

> **source_docs:** `docs/features/FLOW_BUILDER.md` §9.4, §9.5; `docs/features/LIVECHAT.md`; `docs/UX_PRINCIPLES.md` §3; `docs/ROADMAP.md` F4-S14, F4-S15, F4-S16 (consolidados)
> **blocks:** —

## Objetivo
Trazer flows pra dentro do atendimento: (1) **quickbar** de flows `manual` (ordenada por `manual_position`) no ChatHeader (FX-029d); (2) **modal de confirmação** ao disparar um manual flow (FX-031a) → `POST /api/flows/:id/trigger`; (3) **FlowExecutionsBadge** no ChatHeader e na ChatList mostrando execuções ativas da conversa (FX-031c/d), com drill-down (logs/variables/current node) e cancelar.

## Escopo (faz)
- `apps/web/features/flow-builder/livechat/**`: `ManualFlowsQuickbar`, `TriggerConfirmModal`, `FlowExecutionsBadge`, `ExecutionDetailDrawer`, hooks `useManualFlows`/`useFlowExecutions` (TanStack Query + socket de execution updates).
- Componentes autocontidos; o wiring de montagem no ChatHeader/ChatList (conversations feature) é gap-fill do orchestrator (padrão F3), 2-3 linhas.

## Fora de escopo
- Editor/lista (F4-S09/S10/S11), engine/API (F4-S02/S08).

## Arquivos permitidos
- `apps/web/features/flow-builder/livechat/**`

## Definition of Done
- [ ] Quickbar lista manual flows; click → confirm modal → trigger; badge mostra execuções ativas e permite cancelar (`flow.cancel`).
- [ ] Atualização em tempo real via socket (execution status muda → badge/drawer atualizam).
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §3 quickbar acima do composer, discreta; modal de confirmação curto (não full-screen); badge não-intrusivo; estados loading/empty/error; tokens DS v2 (zero hex).

## Permission scope
- Disparar manual → `flow.trigger` (STAFF); cancelar → `flow.cancel` (STAFF). Esconder quickbar/ações sem permissão.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Consolida 3 ports do v1 (FX-029d/031a/031c-d) num só slot porque todos tocam a mesma superfície (ChatHeader/ChatList) — separá-los colidiria.
