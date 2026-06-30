---
id: F55-S09
title: QA ponta a ponta da F55 — role-awareness, dados, realtime, design
phase: F55
status: done
priority: high
estimated_size: S
depends_on: [F55-S06, F55-S07, F55-S08]
agent_id: qa-engineer
source_docs:
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
  - docs/features/PERMISSIONS.md
completed_at: 2026-06-30T00:04:02Z

---
# F55-S09 — QA ponta a ponta do Dashboard v3

## Objetivo

Validar a fase F55 inteira: filtragem por role server-side, precisão dos timestamps de ciclo, cards novos,
realtime de fato funcionando, e o checklist de design/UX. Caçar gaps/edge cases antes do merge da fase.

## Contexto

Fecha a F55 (rebuild do dashboard ponta a ponta). Depende de toda a cadeia: dados (S01/S02/S03), registry
(S04), cards novos backend+front (S05/S07), shell/redesign (S06), realtime (S08).

## Escopo

### files_allowed
- `apps/api/src/services/dashboard/__tests__/**`
- `apps/web/features/dashboard/__tests__/**`
- `tasks/COMMS.md` (registrar achados, append-only)

### files_forbidden
- Qualquer código de produção (QA reporta; correção volta ao slot dono via COMMS)

## Escopo (faz)
- **Role-awareness:** para cada role (AGENT/SUPERVISOR/ADMIN/OWNER/READONLY), `/api/dashboard/me` retorna
  exatamente o conjunto esperado — AGENT nunca recebe custo IA/placar; READONLY vê informativo sem ação.
- **Dados exatos:** após resolver uma conversa, `resolved_at` grava; SLA/TTR refletem o real (não `messages`);
  `first_response_at` grava só na 1ª resposta. MV 30d conta por `resolved_at`.
- **Cards novos:** Placar IA×Humano soma certo (IA vs humano, líquido de cancelados); ROI trata custo 0;
  Funil ordena por estágio.
- **Realtime:** resolver conversa / registrar conversão dispara `dashboard:metric_changed` e o front
  atualiza sem refresh (validar o caminho do socket; e2e manual já que Playwright não hidrata local).
- **Design/UX:** rodar mentalmente o checklist `UX_PRINCIPLES.md §4` + clareza pedida pelo founder
  (Stripe/Datacrazy): KPIs legíveis, drill em drawer, empty/loading/error, zero hex, responsivo.
- Edge cases: workspace sem conversões (cards gated somem), sem deals (funil vazio), custo IA 0, member sem times.

## Fora de escopo
- Implementar correções (volta ao slot dono). Mudar contrato.

## Definition of Done
- [ ] Matriz de roles verificada (5 roles) — nenhum vazamento de card não-autorizado.
- [ ] Timestamps de ciclo exatos em fluxo novo; MV 30d sobre `resolved_at`.
- [ ] Cards novos corretos (incl. casos null/vazio); realtime atualiza sem refresh.
- [ ] Checklist UX + clareza aprovados (ou achados registrados em COMMS com severidade).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter @hm/api test`, `pnpm --filter @hm/web test` verdes.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web test
```

## Notas
Login dev: `AUTH_PROVIDER=mock`, API `:3001`, `owner@dev.local` (OWNER+platform admin). Para testar outros
roles, trocar o role do member no DB dev. Playwright não hidrata no Windows local — e2e real só em CI/prod-like.
Após o QA, rodar os gates `/hm-designer` (UI) e `/hm-security` (authz/RLS/validação Zod) como passo de fase.
