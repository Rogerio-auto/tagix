---
id: F72-S04
title: Home no DS 3.0 — o que mudou, precisa da sua atenção e resultado no topo
phase: F72
status: review
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
completed_at: 2026-10-14T19:26:34Z

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

## Notas de execução (orchestrator, 2026-10-14)

Retomado do stash "F72-S04 parcial" (Home, today, API home). Concluído por backend-engineer (API) e frontend-engineer (web), com três rodadas de correção depois dos portões.

- **API:** `services/dashboard/home-model.ts` (contrato + funções puras), `home.ts` (agregações), `viewer-scope.ts` (predicado de visibilidade F30 para não OWNER/ADMIN; `SET LOCAL statement_timeout = 5000` em Home, Today, loadDashboard e drillDown), `routes/dashboard/{home-query.ts,today-scope.ts}`. `GET /api/dashboard/home?period=7d|30d|90d`. Speed-to-lead = mediana até a 1ª saída `member`/`agent` após a 1ª mensagem do contato (`system` não conta). Delta contra a janela anterior do mesmo tamanho ("desde a última visita" não existe no modelo, não foi inventado). Papel validado com Zod (403 fail-closed) em /home, /today, /me e /metrics; `Cache-Control: private, no-store` nas 4.
- **Escopo por papel:** OWNER/ADMIN = workspace; SUPERVISOR = workspace nos agregados (receita, conversões, leads, jornada) e departamentos que lidera na fila/atenção/speed-to-lead; AGENT/READONLY = pessoal (fila dele, sem receita/jornada/série). Nenhum custo de IA/infra no contrato. Agenda da Today = `accessibleCalendarIds` para todos os papéis.
- **Web:** Home em `features/dashboard/home/**` (KPIs em subgrid, seletor 7/30/90, atenção com ação direta, fila e agenda da antiga Hoje, estados vazio/carregando/erro, painel F8 preservado em "Painel completo"), throttle de 3s nas invalidações por socket (`realtime-batch.ts`, `metric-changed-listener.ts`).
- **Pendências da S03:** (a) mock padrão do e2e responde `/api/dashboard/home` e `/today`; (b) Home = `/`, `/hoje` faz redirect 307 para `/`, `start_url: '/'`, `nav.ts` Home -> `/` e "Dashboard" saiu do "Mais"; (c) `e2e/mobile-navigation.spec.ts` já havia sido removido em 5dea8f30.
- **Desvios de files_allowed (autorizados, ver COMMS):** `shared/components/layout/nav.ts(+test)`, `e2e/specs/{mobile-nav,shell,auth,journey}.spec.ts`, `e2e/fixtures/{seed,api-mock}.ts`, `public/sw.js`, `public/sw-strategy.js`, `shared/pwa/strategy.test.ts`, `services/dashboard/{load-dashboard,drill-down}.ts`.

### Validação (orchestrator, números reais)

- `pnpm --filter @hm/web typecheck`: 0 erros. `pnpm --filter @hm/api typecheck`: 0 erros.
- vitest web `features/dashboard features/today shared`: 21 arquivos, 260/260.
- vitest api `src/routes/dashboard src/services/dashboard`: 6 arquivos sem banco verdes (78 testes). **Não executados (requer infra, ECONNREFUSED :5442):** `home.test.ts`, `today.test.ts`, `load-dashboard.test.ts`, `queries.test.ts`, `negocio-metrics.test.ts`, `cycle-metric-queries.integration.test.ts`. O SQL novo (speed-to-lead, predicado F30 sem alias) **nunca rodou contra Postgres**: rodar antes do deploy.
- eslint: api 0 problemas; web 0 erros, 9 avisos preexistentes.
- Playwright (worker, `E2E_SERVER=start`, sem Docker): home + mobile-nav + shell + auth + journey = 55 verdes. axe não existe no repo; contraste medido no e2e.

### Revisão de design

1ª: REPROVADO (KPIs fora da linha de base; capturas sem provar o DoD). 2ª: REPROVADO (ReservedSlots quebrando em 768). Corrigido e conferido na captura `home-768-*-2-inteira.png`: **APROVADO COM RESSALVAS** ("parece resultado acontecendo, não painel"). Ressalvas fora do slot: "Leadium" vs "tagix" em PushToggle/InstallPrompt; faixa cinza na borda direita do main no claro (shell); locale do produto segue o navegador.

### Segurança (security-auditor)

1ª: REPROVADO (H1 SUPERVISOR via fila/agenda sem visibilidade F30; M1 cache; M2 carga). Re-verificação: **APROVADO COM RESSALVAS**. M-1 e L-1 residuais corrigidos depois. Abertos: L-2 falta teste de integração com RLS real do predicado F30; L-3 `attentionStalledDeals` do SUPERVISOR no nível do workspace (igual a `GET /api/deals`); micro-cache e rate limit em `/api/dashboard/*` como follow-up.
