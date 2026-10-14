---
id: F72-S04
title: Home no DS 3.0 — o que mudou, precisa da sua atenção e resultado no topo
phase: F72
status: in-progress
priority: critical
estimated_size: L
ui: true
depends_on: [F72-S02, F72-S03]
blocks: [F72-S09]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/features/DASHBOARD.md
  - docs/design/ds-3.0-agency-os.html
agent_id: backend-engineer
claimed_at: 2026-10-14T17:56:07Z

---
# F72-S04 — Home: o que mudou e o que precisa da sua atenção

## Objetivo

A página inicial deixa de ser um painel de cards e passa a mostrar **resultado acontecendo**, como no "Overview" da maquete:
- saudação com o que mudou desde a última visita;
- KPIs de primeira classe: receita atribuída, leads, speed-to-lead e conversões, com número em mono;
- a lista "Precisa da sua atenção", com ação direta em cada item.

## Contexto

Hoje existem `/` (`features/dashboard`, role-aware pelo servidor, F8) e `/hoje` (`features/today`, visão de dono, F61). O DS 3.0 junta os dois papéis numa Home só: resultado no topo e depois atenção.

## Escopo (faz)

- Unificar `/` e `/hoje` numa Home. `/hoje` redireciona para `/`, para não quebrar o atalho do PWA (`start_url`). Conferir o manifest.
- Dados:
  - reaproveitar `/dashboard/me` (cards e alertas já filtrados por papel) e o que a Hoje usa;
  - **speed-to-lead**: se não existir métrica no backend, criar a agregação na API (tempo até a 1ª resposta humana ou da IA, mediana do período), com teste;
  - **"o que mudou"**: delta contra o período anterior. "Desde a última visita" só se houver dado; não inventar.
- "Precisa da sua atenção": conversas sem resposta acima do SLA, deals parados, conexão de canal caída, trial perto do fim (o banner da F71 continua), mídia que falhou. Cada item com ação.
- Role-aware (regra do §07): agente vê a fila dele; dono vê o resultado; custo de IA só para quem pode agir (ADMIN/OWNER), nunca para AGENT/READONLY.
- Personalização (F8 `customization`) preservada ou migrada sem perder o layout salvo.
- Estados vazio (empresa nova, ligado ao checklist da F43), carregando e erro.
- Tempo real (`useDashboardSocket`) mantido.
- Mobile: resultado no topo, depois atenção (é a aba Home).

### files_allowed

- `apps/web/app/(app)/page.tsx`, `apps/web/app/(app)/hoje/**`
- `apps/web/features/dashboard/**`, `apps/web/features/today/**`
- `apps/web/app/manifest.ts` (só se `start_url` mudar)
- `apps/api/src/routes/dashboard/**`, `apps/api/src/services/dashboard/**` (só para speed-to-lead/delta, com testes)
- `apps/web/e2e/specs/home*.spec.ts` (novos)

## Definition of Done

- [ ] Home fiel ao Overview da maquete, nos dois temas e em 375/768/1440
- [ ] teste: um AGENT não recebe custo nem métrica de dono (servidor)
- [ ] speed-to-lead e delta com teste de agregação (se criados)
- [ ] `/hoje` redireciona; PWA abre na Home
- [ ] e2e da Home (API mockada); axe sem violação séria
- [ ] revisão `/hm-designer`: "parece resultado acontecendo, não painel"

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/dashboard features/today --maxWorkers=1
pnpm --filter @hm/api typecheck
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/dashboard src/services/dashboard --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer` (+ `backend-engineer` se precisar de agregação nova).
