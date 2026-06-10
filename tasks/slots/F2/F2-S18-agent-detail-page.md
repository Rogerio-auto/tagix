---
id: F2-S18
title: Frontend AgentDetailPage com tabs (Config, Tools, Knowledge, Metrics, Playground)
phase: F2
status: done
priority: medium
estimated_size: M
depends_on: [F2-S16, F2-S17]
agent_id: backend-engineer
claimed_at: 2026-06-10T04:06:06Z
completed_at: 2026-06-10T04:06:07Z

---
# F2-S18 — AgentDetailPage (tabs)

> **source_docs:** `docs/UX_PRINCIPLES.md` §2/§3; `docs/AGENTS_LANGGRAPH.md` §6/§8; `docs/ROADMAP.md` F2-S18
> **blocks:** F2-S19

## Objetivo
Página de detalhe do agente com tabs: **Config** (modelo/prompt/parâmetros), **Tools** (toggle de `agent_tools`), **Knowledge** (placeholder até F3), **Metrics** (custo/execuções de `agent_metrics`), **Playground** (slot da aba — o componente vem de F2-S19).

## Escopo (faz)
- `apps/web/app/(app)/agents/[id]/**`: rota de detalhe + layout de tabs (async params Next 15).
- `apps/web/features/agents/detail/**`: ConfigTab, ToolsTab, MetricsTab, KnowledgeTab (placeholder), shell de tabs; queries de detalhe próprias.

## Fora de escopo
- O Playground em si (F2-S19 entrega o componente; esta página só reserva a aba), KB real (F3).

## Arquivos permitidos
- `apps/web/app/(app)/agents/[id]/**`
- `apps/web/features/agents/detail/**`

## Definition of Done
- [ ] Tabs navegáveis; Config salva (PUT), Tools toggla, Metrics mostra agregados, Knowledge placeholder.
- [ ] `pnpm --filter @hm/web typecheck`/lint + build verdes.

## UX considerations
- §2 tabs como navegação clara (sem gear-only entry); §2.7 skeleton por aba; estados de erro 3-partes; tokens DS v2 (zero hex).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
Importa `queries.ts`/`types.ts` de F2-S17 (read-only). A aba Playground monta `<AgentPlayground>` de F2-S19 quando disponível.
