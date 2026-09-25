---
id: F70-S08
title: Defesa em profundidade da trava da IA e teste permanente da atribuição no deal
phase: F70
status: review
priority: high
estimated_size: S
depends_on: [F70-S07]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S07-ligar-origem-atribuicao-e-trava-da-ia.md
agent_id: backend-engineer
claimed_at: 2026-09-25T03:56:54Z
completed_at: 2026-09-25T04:12:33Z

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

- [x] nenhum UPDATE para `ai_mode='on'` automático sem a trava (grep documentado no slot)
  *(ver "Auditoria: quem escreve `ai_mode='on'`")*
- [x] testes da retomada e da transferência com conversa `sem-origem`
  *(`apps/workers/src/agents/reengagement-origin-gate.test.ts` e
  `apps/api/src/internal/tools/agent-transfer-origin-gate.test.ts`, Postgres dev; unitários
  da recusa em `reengagement.test.ts` e `agent-transfer-handlers.test.ts`)*
- [x] teste permanente da atribuição no deal passando contra o Postgres dev
  *(`apps/api/src/routes/pipeline/deal-attribution.test.ts`, 9 testes)*

## Decisões

- **Uma regra só.** Os três caminhos usam `AI_ELIGIBLE_CONVERSATION_ORIGINS` (`@hm/flow-engine`,
  derivado de `isAiEligibleOrigin`), sempre como `UPDATE ... WHERE origin IN (...)`: atômico, sem
  janela entre ler e ligar, e fail-closed (NULL não está no IN).
- **`campaigns-inbound/db-ports.ts`**: o `handoffToAgent` cru foi removido. Ele agora chama
  `setConversationAi` do port de outbound da flow-engine (default `createOutboundPort()`,
  injetável por `deps.ai`). Recusa vira `warn`, sem erro (o processor segue com opt-out/followup).
  A composição do worker continua envolvendo com `gateCampaignAiHandoff` (S07), que SUBSTITUI o
  método (spread), então não há escrita dupla. Quem montar os ports sem o wrapper também está travado.
- **Retomada (`reengagement.ts`)**: `resumeAiMode` virou UPDATE condicional e devolve se aplicou.
  Barrado → não publica o `flow.run.requested`, loga `warn` e conta em `blockedByOrigin` (novo campo
  do resultado do tick). A marca de idempotência já foi gravada antes, então a recusa é logada uma
  vez por janela, não a cada minuto. A conversa fica `paused` com `human_takeover`; um humano pode
  religar à mão. O SELECT de elegíveis não filtra origem de propósito: a trava mora no UPDATE, que é
  o ponto que muda estado.
- **Transferência IA→IA (`agent-transfer-handlers.ts`)**: UPDATE condicional
  `origin IN (elegíveis) OR ai_mode = 'on'`. A trava protege a transição para `on`; se a IA já está
  `on` (ligada por caminho travado ou à mão por um humano, permitido pela S07), transferir só troca o
  agente e não liga nada. Conversa `off`/`paused` sem origem: nada muda, nada é enfileirado, o agente
  recebe `ok:false` ("Transferência recusada: esta conversa não tem origem comprovada para
  atendimento automático.") e o evento é logado (`warn`, logger injetável). Não precisa de SELECT
  extra para distinguir "não encontrada" de "barrada": a conversa foi lida na mesma tx logo antes.

## Auditoria: quem escreve `ai_mode='on'`

Grep (código de produção TS, sem testes e sem `apps/web`):

```text
git grep -nE "aiMode:|set +ai_mode|ai_mode *=" -- 'apps/api/src/**/*.ts' 'apps/workers/src/**/*.ts' 'packages/*/src/**/*.ts' ':!*.test.ts' ':!**/__tests__/**'
```

Filtrando comentários, leituras (`select`/`where`/`aiMode: conversations.aiMode`) e escritas de
`off`/`paused`, sobram exatamente estas escritas que podem resultar em `on`:

| Arquivo | Caminho | Tipo | Trava |
| --- | --- | --- | --- |
| `packages/flow-engine/src/ports/outbound.port.ts:56` | `setConversationAi` (flow `ai_action`, handoff de campanha) | automático | `WHERE origin IN (elegíveis)` quando `on` (S07) |
| `apps/workers/src/campaigns-inbound/db-ports.ts:175` | `handoffToAgent` → `setConversationAi` do port acima | automático | mesma trava (não há mais UPDATE próprio) |
| `apps/workers/src/inbound/ai-gate.ts:32` | `gateCampaignAiHandoff` → `setConversationAi` | automático | mesma trava (S07) |
| `apps/workers/src/agents/reengagement.ts:447` | retomada por ociosidade / horário comercial | automático | `WHERE origin IN (elegíveis)` (S08) |
| `apps/api/src/internal/tools/agent-transfer-handlers.ts:179` | tool `transfer_to_agent` | automático | `WHERE origin IN (elegíveis) OR ai_mode='on'` (S08) |
| `apps/api/src/routes/conversations/agent.ts:291` | `POST /conversations/:id/agent` | manual (humano) | permitido por decisão (S07) |
| `apps/api/src/routes/conversations/state.ts:249` | `PATCH /conversations/:id/state` | manual (humano) | permitido por decisão (S07) |

Fora do TypeScript: o runtime Python (`apps/agent-runtime`) só escreve `ai_mode='off'`
(`transfer_to_human`); nenhuma migração tem trigger ou default `on` (`0004`: `DEFAULT 'off'`).
`coexistence/db-ports.ts:495` é a entrada de `planHumanReply` (lê o estado, só pausa).

## Pendências e riscos

- `processCampaignInbound` ainda devolve `handedOff: true` quando a trava recusa (o contrato do port
  é `Promise<void>`; mudar exige mexer em `inbound/ai-gate.ts`, fora desta fronteira). Só afeta o
  outcome/log do processor, não o estado da IA.
- O worker de agentes (`agents/run.ts`) continua sendo a última barreira (só responde com
  `ai_mode='on'`) e não checa origem, por decisão da S07 (o humano pode ligar à mão).
- Não verificado (fora do escopo): `POST /api/deals` com `conversationId` de outro workspace. A
  atribuição vem vazia (leitura sob RLS), mas a FK `deals.conversation_id` não é escopada por
  workspace. Vale um teste de IDOR no slot que cuidar de `deals/crud.ts`.

## Validação

O vitest de `@hm/workers` não carrega o `.env` (a API carrega via `test-setup.ts`), e os testes de
DB pulam sem `DATABASE_URL`. Por isso o `node --env-file=.env`: sem ele os testes da trava
"passariam" sem rodar.

```bash
pnpm --filter @hm/api exec vitest run src/routes/pipeline src/routes/deals src/internal/tools --maxWorkers=2
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents src/campaigns-inbound src/inbound/origin-gate.test.ts --maxWorkers=2
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
```
