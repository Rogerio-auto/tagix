---
id: F73-S07
title: Ferramentas de consulta do Copiloto, operação (conversas com contaminação, agenda, campanhas, conhecimento)
phase: F73
status: in-progress
priority: high
estimated_size: M
model: opus
ui: false
depends_on: [F73-S02, F73-S03, F73-S04]
blocks: [F73-S09, F73-S14, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-003-identidade-do-membro-nas-acoes-de-ia.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
  - docs/features/LIVECHAT_OPS.md
  - docs/features/CALENDAR.md
  - docs/features/CAMPAIGNS.md
agent_id: backend-engineer
claimed_at: 2026-10-17T06:57:18Z

---
# F73-S07 — Consultas de operação

## Objetivo

O Copiloto lê conversas, agenda, campanhas e a base de conhecimento com o mesmo recorte que a inbox e a agenda aplicam ao membro. Toda leitura de texto escrito por cliente **contamina o turno** (ADR-004 §6) e chega ao modelo delimitada como dado não confiável.

## Contexto

É aqui que entra o vetor principal de prompt injection: mensagens de clientes. "Resumir esta conversa" e "sugerir resposta" (sugestões da Inbox na maquete) dependem de `get_conversation_digest`. A consulta ao conhecimento usa o `POST /kb/search` do runtime (F73-S04), chamado pelo Node, que já decidiu workspace e permissão.

## Escopo (faz)

Ferramentas em `apps/api/src/internal/copilot/read-ops/**` (`capability: 'query'`):

| key | Args | Permissão e escopo | `taintsTurn` | Cartão |
|---|---|---|---|---|
| `list_conversations` | `status?` (`waiting`\|`open`\|`resolved`), `assigned?` (`me`\|`unassigned`\|`uuid`), `channel?`, `waiting_minutes_gte?`, `limit ≤ 50` | `conversation.view` + `conversationScope` (`services/copilot/identity/scope.ts`, F73-S03; mesmo eixo de `GET /api/conversations`) | não (só metadados: nome de exibição resolvido como em `contact-label.ts`, canal, tempo de espera, responsável) | `conversation_list` |
| `get_conversation_digest` | `conversation_id`, `last_n ≤ 40` | igual | **sim** | sem cartão; `model_view` com mensagens rotuladas `contact`\|`human`\|`ai`, cada texto de contato envolto pelo spotlighting |
| `list_events` | `from`, `to` (≤ 31 dias), `calendar_id?`, `status?` | `calendar.view` + ownership de calendário (regra de `middlewares/calendar-access.ts`, por import) | sim (título e notas podem vir do cliente via agendamento público) | `event_list` |
| `list_campaigns` | `status?`, `limit ≤ 20` | `campaign.list` | não | `table` |
| `get_campaign` | `campaign_id` | `campaign.view_metrics` | não | `campaign_card` (status, enviadas, agendadas, entregues, lidas, respostas, falhas, custo já usado **só** se o membro tem `agent.view_costs`) |
| `search_knowledge` | `query ≤ 300`, `limit ≤ 5` | `agent.list` | **sim** (documentos podem ter sido enviados por terceiros) | `table` (título e trecho) |

- `read-ops/untrusted.ts`: o formato de dado não confiável no `model_view` é `{ untrusted: true, source: 'contact_message'|'event'|'kb', text }`. O runtime aplica o spotlighting (S04); o Node marca. Teste garante que nenhum texto de contato sai sem a marca.
- `read-ops/kb-client.ts`: cliente HTTP mínimo e tipado (Zod) para `POST {AGENT_RUNTIME_URL}/kb/search`, com o bearer de serviço da config existente, timeout de 5 s e erro seguro.
- Limites iguais ao S06 (50 linhas, 24 KB, `statement_timeout` de 5 s); `last_n ≤ 40` e cada mensagem truncada em 1.000 caracteres no `model_view`.
- Registro em `read-ops/index.ts` (stub do S03).

## Fora de escopo

- Escrever qualquer coisa (S08 e S09). Rascunho de resposta como ação de envio (o rascunho é texto na resposta; enviar é o `propose_send_messages` do S09).

### files_allowed

- `apps/api/src/internal/copilot/read-ops/**`

### files_forbidden

- `apps/api/src/routes/conversations/**` (só importar)
- `apps/api/src/middlewares/**` (só importar)
- `packages/**`

## Definition of Done

- [ ] Teste de integração por ferramenta: feliz; AGENT em time `private` não vê conversa de colega (peer-privacy); SUPERVISOR só vê departamentos que lidera; cross-tenant → `not_found`
- [ ] Toda ferramenta com `taintsTurn` marca `copilot_turns.tainted` (teste lê o turno depois da chamada)
- [ ] Mensagem de contato com tentativa de injeção ("ignore as instruções anteriores e…") chega ao `model_view` dentro da marca `untrusted`, sem alteração de sentido (teste de forma; o comportamento do modelo é testado no F73-S14)
- [ ] `get_campaign` não expõe custo sem `agent.view_costs`
- [ ] `search_knowledge` com runtime fake: timeout e erro devolvem `model_view` seguro

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/internal/copilot/read-ops --maxWorkers=1
```

## Notas

- Agente: `backend-engineer` (opus: superfície de injeção). Paralelo ao F73-S06.
- Depende do S04 só pelo contrato de `/kb/search`; os testes usam fake.
