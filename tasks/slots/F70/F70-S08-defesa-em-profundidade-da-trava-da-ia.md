---
id: F70-S08
title: Defesa em profundidade da trava da IA e teste permanente da atribuição no deal
phase: F70
status: in-progress
priority: high
estimated_size: S
depends_on: [F70-S07]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S07-ligar-origem-atribuicao-e-trava-da-ia.md
agent_id: backend-engineer
claimed_at: 2026-09-25T03:56:54Z

---
# F70-S08 — Defesa em profundidade da trava da IA e teste permanente da atribuição no deal

> Sub-slot da F70: pendências que a S07 deixou fora da fronteira.

## Objetivo

Nenhum caminho automático conseguir ligar a IA numa conversa sem origem comprovada, nem por código morto religado no futuro, e a cópia da atribuição para o deal ter teste permanente.

## Escopo

### files_allowed

- `apps/workers/src/campaigns-inbound/**`
- `apps/workers/src/agents/reengagement.ts`
- `apps/workers/src/agents/*.test.ts`
- `apps/api/src/internal/tools/agent-transfer-handlers.ts`
- `apps/api/src/internal/tools/*.test.ts`
- `apps/api/src/routes/pipeline/*.test.ts`
- `apps/api/src/routes/deals/*.test.ts`

## Escopo (faz)

- Trocar o `handoffToAgent` cru de `campaigns-inbound/db-ports.ts` pelo port travado (ou remover o caminho cru).
- `reengagement.ts` (retomada por `ai_resume_at`) e `agent-transfer-handlers.ts` checam a origem com a mesma regra (`isAiEligibleOrigin`); se não for elegível, não liga e loga.
- Teste permanente da cópia de atribuição para o deal (`ensureDealForConversation` e `POST /api/deals` com `conversationId`): primeiro referral pelo horário do provider vence; conversa sem referral → deal sem `ad_*`. Base: o teste temporário da S07 em `scratchpad/zz-f70s07-deal-attribution.tmp.test.ts`.

## Definition of Done

- [ ] nenhum UPDATE para `ai_mode='on'` automático sem a trava (grep documentado no slot)
- [ ] testes da retomada e da transferência com conversa `sem-origem`
- [ ] teste permanente da atribuição no deal passando contra o Postgres dev
