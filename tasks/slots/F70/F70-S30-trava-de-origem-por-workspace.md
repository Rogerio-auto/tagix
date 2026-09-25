---
id: F70-S30
title: Trava de origem da IA como configuração do workspace
phase: F70
status: review
priority: high
estimated_size: M
depends_on: [F70-S28]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S07-ligar-origem-atribuicao-e-trava-da-ia.md
  - tasks/slots/F70/F70-S19-achados-da-auditoria-apos-s15-s16.md
agent_id: backend-engineer
claimed_at: 2026-09-25T20:45:07Z
completed_at: 2026-09-25T21:38:01Z

---
# F70-S30 — Trava de origem da IA como configuração do workspace

## Objetivo

Cada workspace decide se a IA só atende conversas com origem comprovada (anúncio, site, Instagram) ou qualquer conversa. Decisão do Rogério em 25/09: a trava vira uma funcionalidade do produto.

## Contexto

- A trava (F70-S07/S08/S19/S23) hoje vale para todos os workspaces. Faz sentido para número pessoal, onde família e amigos não podem receber IA, e atrapalha um cliente com número só comercial, que quer IA em todo lead.
- Decisões de 25/09 que ficam registradas: **Direct do Instagram conta como origem comprovada** (comportamento atual, mantido); campanhas e conversas antigas continuam sob a regra.

## Escopo

### files_allowed

- `packages/db/drizzle/**` *(migração, se a configuração virar coluna; senão, `workspaces.settings`)*
- `packages/db/src/schema/index.ts`
- `packages/shared/src/conversation-origin*.ts`
- `packages/flow-engine/src/ports/outbound.port.ts`
- `packages/flow-engine/src/**/*.test.ts`
- `apps/workers/src/agents/run.ts`
- `apps/workers/src/agents/reengagement.ts`
- `apps/workers/src/agents/*.test.ts`
- `apps/workers/src/inbound/ai-gate.ts`
- `apps/workers/src/campaigns-inbound/db-ports.ts`
- `apps/api/src/internal/tools/agent-transfer-handlers.ts`
- `apps/api/src/routes/settings/**`
- `apps/api/src/routes/workspace*/**`
- `apps/web/features/settings/**`
- `apps/web/app/(app)/settings/**`
- `packages/flow-engine/src/ai-origin-gate.ts`, `packages/flow-engine/src/index.ts` *(correção 2026-09-25: a regra única da trava já mora aqui desde a F70-S07; é o lugar da fonte única que passa a ler a configuração do workspace, e o index exporta os novos predicados)*
- `apps/api/src/internal/tools/agent-transfer-origin-gate.test.ts`, `apps/workers/src/inbound/origin-gate.test.ts`, `apps/workers/src/campaigns-inbound/db-ports.test.ts` *(correção 2026-09-25: o briefing pede o caso da trava desligada em cada caminho, e estes são os testes existentes de cada caminho)*
- `apps/api/src/internal/tools/agent-transfer-handlers.test.ts` *(correção 2026-09-25: os mocks de `@hm/db` e `drizzle-orm` do teste unitário não tinham `schema.workspaces` nem a tag `sql`, que o predicado da trava passa a usar; duas linhas nos mocks)*

*(Antes de editar fora da lista, nota de correção no slot, no padrão da F69-S03.)*

## Escopo (faz)

- Configuração por workspace: `aiRequiresProvenOrigin` (nome final a critério do engenheiro, documentado).
  - **Padrão ligado** (fail-closed) em todo workspace, incluindo o do Rogério.
  - Um cliente com número só comercial desliga.
- Todos os caminhos automáticos da trava (os 5 da auditoria da S08 mais o gate `authorizeAiReply`) passam a consultar a configuração numa fonte única. Com a trava desligada, a regra antiga (origem elegível ou marca humana) vira "sempre elegível", e o resto fica igual.
- Só OWNER/ADMIN altera a configuração, com auditoria (quem, quando, valor anterior).
- Tela em Configurações → IA: um interruptor com uma frase clara, por exemplo "Responder só quem chegou por anúncio, site ou Instagram. Recomendado se este número também é pessoal." DS v2, dark-first.

## Definition of Done

- [x] teste: trava ligada → conversa `sem-origem` sem IA; desligada → IA atende (`packages/flow-engine/src/ai-origin-gate.test.ts`, banco real)
- [x] teste: cada caminho automático respeita a configuração (flow `ai_action` e handoff de campanha em `inbound/origin-gate.test.ts` e `campaigns-inbound/db-ports.test.ts`; retomada em `reengagement-origin-gate.test.ts` e `reengagement-human-mark.test.ts`; transferência em `agent-transfer-origin-gate.test.ts`; gate do worker em `run-origin-gate.test.ts`)
- [x] teste: só OWNER/ADMIN altera; a alteração é auditada (`apps/api/src/routes/workspace/ai-origin-lock.test.ts`, sessão real + RLS)
- [x] tela com o interruptor e o texto explicativo (Configurações → IA, `AiOriginLockSection.tsx`)

## Decisões

### Onde a configuração mora

- **`workspaces.ai_requires_proven_origin boolean NOT NULL DEFAULT true`** (migração
  **0093_f70_workspace_ai_origin_lock**, `when` 1781452854000; Drizzle: `aiRequiresProvenOrigin`).
  - `true` = trava ligada (regra da F70-S07/S08/S19/S23); `false` = a origem deixa de importar.
  - Coluna e não `workspaces.settings`: tipada, NOT NULL, lida por PK dentro do UPDATE sem parse
    de jsonb (um valor inválido no jsonb faria o cast para boolean lançar dentro do UPDATE que liga
    a IA).
  - O DEFAULT constante liga a trava em todo workspace existente e novo, incluindo o do Rogério.
    Desde o PG 11 não reescreve a tabela. **Já aplicada no Postgres dev compartilhado.**
- Fail-closed também na leitura: o subselect é `coalesce(..., true)` (workspace invisível no
  escopo RLS conta como travado) e, em memória, só o booleano `false` desliga.

### A fonte única da decisão (`packages/flow-engine/src/ai-origin-gate.ts`)

- `aiOriginGateSql()`: predicado SQL `coalesce(origin IN (elegíveis) OR NOT <trava do
  workspace>, false)`. A trava é lida por `workspaceRequiresProvenOriginSql()`, um subselect em
  `workspaces` por `conversations.workspace_id` **dentro do próprio UPDATE**: não existe janela
  entre ler a configuração e ligar a IA. O `coalesce` externo existe porque `origin IN (...)` com
  `origin` NULL é NULL na lógica de três valores; no WHERE já barrava, mas lido como valor não.
- `passesAiOriginGate({ requiresProvenOrigin, origin })`: a mesma decisão em memória, sobre o valor
  que o worker lê com o MESMO `workspaceRequiresProvenOriginSql()`. Um teste contra o banco
  percorre a matriz trava × todas as origens (+ NULL) e exige que SQL e memória concordem.
- A marca humana (S19/S23) continua sendo alternativa somada por `OR` em cada caminho, porque
  cada um a trata de um jeito (retomada preserva, transferência exige IA já `on`, worker compara
  as marcas). Com a trava desligada o predicado já passa, então a marca deixa de importar.
- **Religar a trava vale no turno seguinte.** O worker relê a configuração em cada turno. Uma
  conversa ligada automaticamente com a trava desligada carrega `ai_auto_enabled_at` (trigger da
  0088) e, sem marca humana, para de receber IA assim que a trava volta. É o fail-closed certo
  para quem desligou por engano.
- "Campanhas e conversas antigas continuam sob a regra" (Contexto) foi lido como: não há exceção
  para elas. Obedecem à trava do workspace como qualquer caminho automático.

### Caminhos automáticos

| Caminho | Onde | Como consulta |
| --- | --- | --- |
| flow `ai_action` ACTIVATE/TRANSFER | `packages/flow-engine/src/ports/outbound.port.ts:51` | `and(byId, aiOriginGateSql())` |
| handoff de campanha (composição do inbound) | `apps/workers/src/inbound/ai-gate.ts:35` → port acima | mesmo UPDATE |
| handoff de campanha (ports crus) | `apps/workers/src/campaigns-inbound/db-ports.ts:208` → port acima | mesmo UPDATE |
| retomada (`resumeAiMode`) | `apps/workers/src/agents/reengagement.ts:493` | `or(aiOriginGateSql(), keeps_human_mark(...))` |
| transferência IA→IA | `apps/api/src/internal/tools/agent-transfer-handlers.ts:189` | `or(aiOriginGateSql(), ai_mode = 'on')` |
| gate do worker (`authorizeAiReply`) | `apps/workers/src/agents/run.ts:308` (decisão), `:876` (leitura) | `passesAiOriginGate` sobre `workspaceRequiresProvenOriginSql()` |

`AI_ELIGIBLE_CONVERSATION_ORIGINS` não é mais usado em nenhum UPDATE de produção; continua
exportado para os testes e para quem só precisa da lista.

### Quem altera e auditoria

- `GET`/`PATCH /api/workspace/ai-origin-lock` (`apps/api/src/routes/workspace/ai-origin-lock.ts`),
  guard `requireAuth + withRLS + requireRole('workspace.edit')` (= OWNER/ADMIN no `ROLE_CAN`).
  Body Zod estrito `{ aiRequiresProvenOrigin: boolean }`.
- O `PATCH /api/workspace` continua `.strict()` e não aceita o campo: a rota auditada é o único
  caminho da API que muda a trava (testado).
- A mudança roda numa transação: `SELECT ... FOR UPDATE` da linha do workspace, UPDATE e
  `audit_logs` (`action = 'workspace.ai_origin_lock.update'`, `resource_type = 'workspace'`,
  `actor_member_id`, `metadata = { previous, next }`, IP e user agent, `created_at`). O
  `FOR UPDATE` garante que o "valor anterior" é o que a mudança substituiu, mesmo com dois admins
  ao mesmo tempo. Pedido sem mudança não audita (`changed: false`).
- `ip_address` é `inet`: um `req.ip` que não seja IP vira NULL em vez de derrubar a transação.
- A trilha aparece na seção Auditoria já existente, e a tela mostra a última alteração.

### Tela (Configurações → IA)

- Seção `ia` no registry, permissão `workspace.edit`. `AiOriginLockSection.tsx`: interruptor com
  "Responder só quem chegou por anúncio, site ou Instagram" e "Recomendado se este número também é
  pessoal…", estado explicado em linguagem simples, última alteração (quem e quando).
- Ligar aplica na hora. Desligar pede confirmação inline (`role="alertdialog"`), porque abre a IA
  para contatos pessoais. Tokens do DS v2 (sem hex; teste checa), dark-first.
- Data no idioma do navegador (`Intl` sem literal de locale, regra do lint).

## Pendências e riscos

- **Conversas ligadas com a trava desligada e depois religada** param de receber IA (ver acima).
  Intencional. Religar em massa não existe, como na S19.
- **Mudança por SQL manual** não passa pela auditoria da rota. Um trigger de auditoria no banco
  não teria o autor (a sessão não carrega o membro em GUC). Fica registrado.
- **Membro removido:** a auditoria mantém a linha, com `actor_member_id` NULL (FK `SET NULL`), e a
  tela mostra "Um membro que saiu do workspace".
- Deploy: aplicar a 0093 antes de subir o código novo (o subselect lê a coluna). O fluxo de deploy
  da F70-S22 já migra antes de subir.

## Validação

O vitest de `@hm/workers` e o de `@hm/flow-engine` não carregam o `.env`: sem o
`node --env-file=.env` os testes de banco da trava pulam e "passariam" sem rodar.

```bash
node --env-file=.env packages/flow-engine/node_modules/vitest/vitest.mjs run --root packages/flow-engine src/ai-origin-gate.test.ts src/ports/outbound.port.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents/run-origin-gate.test.ts src/agents/reengagement-origin-gate.test.ts src/agents/reengagement-human-mark.test.ts src/agents/agents.test.ts src/inbound/origin-gate.test.ts src/campaigns-inbound/db-ports.test.ts --maxWorkers=1
pnpm --filter @hm/api exec vitest run src/routes/workspace src/internal/tools/agent-transfer-origin-gate.test.ts src/internal/tools/agent-transfer-handlers.test.ts --maxWorkers=1
pnpm --filter @hm/web exec vitest run features/settings --maxWorkers=1
pnpm --filter @hm/flow-engine typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api typecheck
```
