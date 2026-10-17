---
id: F73-S15
title: Observabilidade, uso e custo do Copiloto, telemetria de produto e retenção do histórico
phase: F73
status: done
priority: medium
estimated_size: M
model: sonnet
ui: false
depends_on: [F73-S01, F73-S03, F73-S10]
blocks: [F73-S16, F74-S12, F74-S13]
source_docs:
  - docs/features/COPILOTO.md
  - docs/INFRASTRUCTURE.md
agent_id: backend-engineer
claimed_at: 2026-10-17T08:13:39Z
completed_at: 2026-10-17T08:17:32Z

---
# F73-S15 — Observabilidade, custo e retenção

## Objetivo

Quem pode agir sobre o custo vê quanto o Copiloto gastou e com quem. A equipe de produto mede as métricas que decidem o futuro (spec §9: adoção, confirmação, desfazer, aceite do piloto, briefing e latência). Operação tem métricas e alertas. O histórico respeita a retenção escolhida (6, 12 ou 24 meses).

## Escopo (faz)

- `apps/api/src/services/copilot/usage/**` + `apps/api/src/routes/copilot/usage/**`: `GET /api/copilot/usage` (`copilot.view_costs`) → `CopilotUsageSchema`:
  - mês corrente: gasto, teto, % e data de renovação;
  - série diária;
  - top 5 membros por custo (nome e valor; "Quem usou mais o Copiloto este mês?");
  - contagem de turnos e de ações por nível.
  A fonte é `llm_usage_logs` com `surface='copilot'` e `copilot_turns`.
- Alerta de orçamento: ao cruzar `budget_alert_pct`, uma notificação ao OWNER (cascata existente, uma vez por mês por limiar, idempotente). Ao chegar no teto, aplicar o `budget_mode`, já calculado pelo S10; aqui só o aviso.
- Métricas Prometheus em `apps/api/src/observability/**` (padrão existente):
  - `copilot_turns_total{status}` e `copilot_turn_duration_seconds` (histograma);
  - `copilot_ttfb_seconds` (até o `turn_started`);
  - `copilot_tool_calls_total{tool_key,decision}`;
  - `copilot_proposals_total{capability,risk_level,status}`;
  - `copilot_cost_usd_total` (sem rótulo de workspace: cardinalidade).
  Alertas documentados em `docs/runbooks/copilot.md`: p95 de TTFB > 1,5 s por 10 min; taxa de erro > 5%; runtime indisponível.
- Telemetria de produto (sem conteúdo, só eventos e contagens): `GET /api/copilot/insights` (`copilot.manage`, interno da empresa) e a query de plataforma em `docs/runbooks/copilot.md`, com:
  - membros ativos semanais;
  - propostas de nível 3 confirmadas, canceladas e expiradas;
  - taxa de desfazer;
  - aceite do piloto por estágio (aprovadas ÷ decididas, 30 dias);
  - briefing visto no dia;
  - turnos com `format_fallback`.
- Retenção: em `apps/workers/src/retention/**`, varredura diária que apaga `copilot_messages` e `copilot_sessions` mais velhas que `history_retention_months` do workspace, em lotes. **Não** apaga `copilot_action_proposals`, itens, `copilot_tool_calls` nem `audit_logs`: a trilha segue a política de auditoria existente. Esses ficam com o prazo atual de auditoria, documentado no runbook.
- `docs/runbooks/copilot.md`: como ligar e desligar por workspace, trocar o modelo, ler um turno pelo `ref`, investigar ação contestada (Atividade → proposta → itens → `audit_logs`) e cuidados de custo.

## Fora de escopo

- Tela de uso (o bloco de orçamento da F74-S09 consome esta API). Cobrança e créditos (decisão de preço em aberto).

### files_allowed

- `apps/api/src/services/copilot/usage/**`
- `apps/api/src/routes/copilot/usage/**`
- `apps/api/src/observability/**`
- `apps/workers/src/retention/**`
- `docs/runbooks/copilot.md`

### files_forbidden

- `packages/**`

## Definition of Done

- [ ] `/usage` com teste de permissão (AGENT e SUPERVISOR → 403) e números conferidos contra seed
- [ ] Alerta de 80% disparado uma vez só (teste com dois ticks)
- [ ] Métricas expostas e documentadas; cardinalidade revisada (sem `workspace_id`, sem `member_id`)
- [ ] Retenção: apaga mensagens e sessões além do prazo, preserva propostas e auditoria (teste no banco de dev)
- [ ] Runbook escrito

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/copilot/usage src/routes/copilot/usage src/observability --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/retention --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- O custo é mostrado em US$ (moeda do `llm_usage_logs`). Mostrar em R$ depende da decisão de preço e créditos do Rogério. A API devolve `cost_usd`, e a interface formata segundo a decisão.
