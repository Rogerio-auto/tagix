---
id: F73-S17
title: Chave de produção do Copiloto — COPILOT_ENABLED (desligado por padrão) fecha rotas, varreduras, briefing e autopilot
phase: F73
status: done
priority: critical
estimated_size: S
model: sonnet
ui: false
depends_on: [F73-S13]
blocks: []
source_docs:
  - docs/features/COPILOTO.md
  - docs/runbooks/deploy-production.md
agent_id: backend-engineer
claimed_at: 2026-10-19T17:31:29Z
completed_at: 2026-10-19T17:43:57Z

---
# F73-S17 — Chave de produção do Copiloto

## Objetivo

Hoje o Copiloto não tem interruptor: `copilot_settings.enabled` tem `DEFAULT true`, e `apps/api/src/server.ts` liga o
sweeper, o briefing do dia e o alerta de orçamento sempre que `NODE_ENV !== 'test'`; o worker registra o
`copilot-autopilot-scheduler`. Subir o `main` em produção mandaria o briefing das 06:30 a clientes reais de uma função
sem tela e com achados de segurança (F73-S14) em aberto. Esta slot dá uma chave **global de ambiente**, desligada por
padrão em produção, que torna o Copiloto inalcançável e inerte.

## Escopo (faz)

- `apps/api/src/config.ts`: `COPILOT_ENABLED` (booleano estrito via Zod). **Ausente ou inválido em produção = false.**
  Em desenvolvimento e teste o padrão continua `true` (nada muda para quem desenvolve). Função pura exportada
  `parseCopilotEnabled(env)` com teste.
- `apps/api/src/app.ts`: desligado ⇒ **não monta** o router `/api/copilot/*` nem o callback interno do Copiloto
  (resposta 404 uniforme do roteador padrão, sem corpo que revele a existência).
- `apps/api/src/server.ts`: `sweeperEnabled`, `briefingEnabled` e `budgetAlertEnabled` passam a exigir também
  `copilotEnabled`.
- `apps/workers/src/bootstrap/index.ts`: `copilot-autopilot-scheduler` (e qualquer outro job do Copiloto) só é
  registrado se ligado; reutilize a mesma regra de leitura (não duplique a lógica de parse: exporte de `@hm/shared`
  só se já existir um config compartilhado; senão, a função fica em cada app com o mesmo teste).
- `infra/docker/docker-compose.prod.yml`: `COPILOT_ENABLED: ${COPILOT_ENABLED:-false}` em `api` e `workers`.
- `.env.example` e `.env.production.example`: documente `COPILOT_ENABLED` (produção: `false` até o F73-S14 fechar).
- `docs/runbooks/deploy-production.md` §2.5: acrescentar `COPILOT_ENABLED=false` aos mínimos do `.env` com a
  explicação e o critério de ligar.
- Testes: ligado e desligado, na api (404 em `/api/copilot/me`, sem agendadores) e nos workers (autopilot não
  registrado).

## Fora de escopo

- Migrations, `copilot_settings`, qualquer conserto de achado do F73-S14, UI.

### files_allowed

- `apps/api/src/config.ts`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/workers/src/bootstrap/index.ts`
- `apps/api/src/copilot-kill-switch.test.ts`
- `apps/workers/src/bootstrap/copilot-kill-switch.test.ts`
- `infra/docker/docker-compose.prod.yml`
- `.env.example`
- `.env.production.example`
- `docs/runbooks/deploy-production.md`

### files_forbidden

- `packages/db/**`
- `apps/api/src/internal/copilot/**`
- `apps/api/src/services/copilot/**`

## Definition of Done

- [ ] sem `COPILOT_ENABLED` em `NODE_ENV=production`, `/api/copilot/*` e o callback interno respondem 404
- [ ] com ele desligado nenhum job do Copiloto sobe (api e workers), provado por teste
- [ ] em dev e teste o comportamento atual é preservado (suíte existente verde)
- [ ] compose de produção valida com env fictício (`docker compose -f infra/docker/docker-compose.prod.yml config`)
- [ ] zero `any`; typecheck e lint verdes

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api exec vitest run --maxWorkers=1 src/copilot-kill-switch.test.ts
pnpm --filter @hm/workers exec vitest run --maxWorkers=1 src/bootstrap/copilot-kill-switch.test.ts
```

## Notas

- Agente: `backend-engineer` (Sonnet, plano fechado). Revisão de segurança pelo `security-auditor` (Opus) antes do
  `finish`: provar que desligado fecha rotas, callback, os 3 agendadores da api e o autopilot dos workers.
