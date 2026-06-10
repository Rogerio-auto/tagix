---
id: F2-S17
title: Frontend AgentsListPage + AgentCreationWizard
phase: F2
status: done
priority: high
estimated_size: M
depends_on: [F2-S16, F2-S14, F2-S15]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:52:11Z
completed_at: 2026-06-10T03:52:12Z

---
# F2-S17 — AgentsListPage + Creation Wizard

> **source_docs:** `docs/UX_PRINCIPLES.md` §2/§3; `docs/AGENTS_LANGGRAPH.md` §7; `docs/ROADMAP.md` F2-S17
> **blocks:** F2-S18, F2-S19

## Objetivo
Tela de listagem de agentes (status, modelo, ativar/desativar) + wizard de criação guiado por template (RHF + Zod): escolhe template → responde `agent_template_questions` → escolhe modelo (picker filtrado pela policy do workspace) → cria.

## Escopo (faz)
- `apps/web/app/(app)/agents/page.tsx`: lista (empty/loading/error states, CTA criar).
- `apps/web/features/agents/list/**`: AgentsList, AgentCard, status toggle.
- `apps/web/features/agents/wizard/**`: AgentCreationWizard (multi-step painel, RHF+Zod, model picker filtrado por policy).
- `apps/web/features/agents/queries.ts` + `types.ts`: hooks/tipos compartilhados (consumidos também por F2-S18/S19).

## Fora de escopo
- Detail page/tabs (F2-S18), playground (F2-S19).

## Arquivos permitidos
- `apps/web/app/(app)/agents/page.tsx`
- `apps/web/features/agents/list/**`
- `apps/web/features/agents/wizard/**`
- `apps/web/features/agents/queries.ts`
- `apps/web/features/agents/types.ts`

## Definition of Done
- [ ] Lista com estados (vazio com CTA único, skeleton, erro 3-partes); toggle ativa/desativa.
- [ ] Wizard cria agente a partir de template; model picker respeita a policy do workspace.
- [ ] `pnpm --filter @hm/web typecheck`/lint + build verdes.

## UX considerations
- §2.3 painel/drawer (não modal full-screen) para o wizard; §2.6 CTA primário único no empty state; §2.7 skeleton no loading; §2.5 HelpPanel `?` para explicar agentes. Zero hex hardcoded — tokens DS v2.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
`queries.ts`/`types.ts` são owned por este slot; F2-S18/S19 importam (read-only) e adicionam queries próprias nos seus diretórios.
