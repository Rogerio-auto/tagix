---
id: F73-S16
title: (v1.1, NÃO PEGAR) Piloto automático move sozinho, com limite diário, desfazer por 7 dias e registro na Atividade
phase: F73
status: blocked
priority: low
estimated_size: M
model: opus
ui: false
depends_on: [F73-S13, F73-S14, F73-S15, F74-S13]
blocks: []
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
agent_id: backend-engineer
---
# F73-S16 — Mover sozinho (v1.1)

> **NÃO PEGAR.** Este slot é fase posterior. Ele só sai de `blocked` por decisão explícita do Rogério, e a decisão precisa do gatilho da spec §9: aceite das sugestões ≥ 70% e desfazer ≤ 3% por 30 dias no estágio, medido pela F73-S15. A pergunta 3 da nota de UX segue em aberto.

## Objetivo

Num estágio com `mode='auto'` ligado explicitamente por quem tem `copilot.autopilot.manage`, o piloto move sozinho as sugestões de confiança `high`. Respeita o limite diário do estágio, registra cada movimento na Atividade como "Piloto automático" e permite desfazer por 7 dias.

## Escopo (faz)

- API: `PUT /api/copilot/autopilot/rules` passa a aceitar `mode='auto'` atrás do flag `COPILOT_AUTOPILOT_AUTO_ENABLED` (padrão `false`), com confirmação em dois passos na interface: "Ligado por <nome> em <data>" fica no `audit_logs`.
- Worker: depois de gerar as sugestões, para cada regra `auto`:
  - aplica até `daily_limit - já_aplicadas_hoje` sugestões `high`;
  - cada uma é uma proposta `source='autopilot'` executada pelo motor (ADR-004) com `executed_as` = **quem ligou a regra**, revalidando a permissão dessa pessoa a cada execução: se ela perdeu `deal.move` ou saiu da empresa, a regra é desligada sozinha e o OWNER é avisado;
  - o desfazer é de 7 dias.
  O motor vive na API e o worker não importa a API: o worker chama um endpoint interno `POST /internal/copilot/autopilot/apply` com bearer de serviço, e é a API que executa.
- Teto absoluto por workspace (50/dia) acima do limite por estágio; kill switch por workspace em `copilot_settings`.
- Interface (F74-S11) troca "em breve" pelo controle real, com o aviso "Move para Reativação depois de 10 dias sem resposta. Limite de 10 por dia; tudo pode ser desfeito por 7 dias".

### files_allowed

- `apps/api/src/services/copilot/autopilot/**`
- `apps/api/src/routes/copilot/autopilot/**`
- `apps/api/src/internal/copilot/autopilot-apply/**`
- `apps/workers/src/copilot-autopilot/**`
- `apps/web/features/copilot/autopilot/**`

## Definition of Done

- [ ] Gatilho de decisão registrado (números da F73-S15) e aprovação do Rogério anotada aqui
- [ ] Limite diário e teto por workspace com teste; perda de permissão de quem ligou desliga a regra
- [ ] Cada movimento na Atividade com Desfazer por 7 dias
- [ ] `/hm-security` no endpoint interno

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/copilot/autopilot src/routes/copilot/autopilot src/internal/copilot/autopilot-apply --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/copilot-autopilot --maxWorkers=1
```

## Notas

- O schema já suporta (`mode='auto'`, `daily_limit`, `source='autopilot'`, `undo_deadline` de 7 dias): nenhuma migração.
