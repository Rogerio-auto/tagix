---
id: F73-S07
title: Ferramentas de consulta do Copiloto, operação (conversas com contaminação, agenda, campanhas, conhecimento)
phase: F73
status: review
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
completed_at: 2026-10-17T07:24:49Z

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

## Nota de execução (backend-engineer, 2026-10-17)

Arquivos (todos em `apps/api/src/internal/copilot/read-ops/`): `index.ts` (registro das 6), `untrusted.ts`, `kb-client.ts`, `common.ts`, `list-conversations.ts`, `conversation-digest.ts`, `list-events.ts`, `campaigns.ts` (`list_campaigns` + `get_campaign`), `search-knowledge.ts`; testes `read-ops.integration.test.ts`, `kb-client.test.ts`, `untrusted.test.ts`. Reuso do S06 por import (`read-crm/common.ts`, `read-crm/limits.ts`: `startRead` com JIT desligado e `statement_timeout`, `fitModelView`, `clampLimit`, `notFound`, `maskPhone`, `loadWorkspaceFormat`); escopo de `services/copilot/identity/scope.ts`; agenda por `calendarRepo.accessibleCalendarIds` + `expandOccurrences` (os mesmos de `GET /api/events`).

Decisões:
- **Marca `untrusted`**: o runtime só delimita a chave `model_view.untrusted` (`render_model_view`, `prompt.py`), então todo texto de terceiro vai numa LISTA nessa chave, um item por texto, `{ untrusted: true, source, ...metadados do Node, text }`. Metadados (`role`, `at`, `n`, `field`) ficam dentro do item, serializados: texto que imite um campo chega escapado.
- **`source` ganhou `conversation_message`** (além de `contact_message`|`event`|`kb`): no digest, as mensagens da equipe e da IA também vão marcadas (a da IA nasceu lendo o cliente; a da pessoa pode citá-lo). Mais estrito que o slot, sem custo.
- **`list_conversations` não contamina** (como pede o slot), então o `model_view` não leva nome de contato nem prévia (nome pode vir do perfil do canal, escrito pelo contato; mesma linha do `list_deals` do S06). O nome aparece só no cartão, na hierarquia de `contact-label.ts`, com telefone MASCARADO quando não há nome. "Esperando" = `open|pending` com última mensagem do contato; ordem: quem espera há mais tempo primeiro.
- **Digest**: sem cartão; exclui mensagens de sistema, reações e apagadas; mídia sem legenda vai com `kind` e texto vazio; cada mensagem recortada em 1.000 caracteres (por ponto de código); se não couber em 24 KB, saem as MAIS ANTIGAS.
- **`list_events`**: sem `status`, cancelados ficam de fora; `calendar_id` inacessível/de outro workspace/inexistente → `not_found`; ocorrências de série apontam o id do mestre (o sintético `evt:` não é UUID); título, notas e local em `untrusted` (`source: 'event'`), um item por campo, ligados por `n`; leitura limitada a 500 linhas antes da expansão (acima disso, `truncated`).
- **`get_campaign`**: números do rollup `campaign_metrics` (o da tela) + `pending` (destinatários `pending|sending`, o "agendadas") só no `model_view`. **Custo**: não existe fonte de custo por campanha no banco (envio Meta não é precificado; custo de IA não é ligado à campanha). `cost_used` sai `null` para todos; sem `agent.view_costs` nem a chave (nem `currency`/`cost_note`) vai ao modelo. A fonte futura entra em `loadCampaignCostUsed`, atrás da mesma trava.
- **`search_knowledge`**: `createSearchKnowledgeTool(deps)` (config e logger injetáveis; padrão lê `AGENT_RUNTIME_URL`/`AGENT_RUNTIME_TOKEN` a cada chamada). Workspace sempre do grant. Qualquer falha (sem config, timeout 5 s, ≠ 2xx, corpo fora do contrato, rede) → `ok:false, decision:'error'` com mensagem fixa; motivo só no log (`copilot.kb_search_failed`, sem URL/corpo). A chamada HTTP acontece dentro da transação do callback (assinatura do registro): a conexão fica presa até 5 s.

Validação (contagens reais, 2026-10-17, Postgres dev :5442):
- `pnpm --filter @hm/api typecheck`: 0 erros.
- `pnpm exec eslint src/internal/copilot/read-ops` (o `@hm/api` não tem script `lint`): 0 problemas. Prettier aplicado.
- `vitest run src/internal/copilot/read-ops --maxWorkers=1`: **3 arquivos / 41 testes verdes** (integração 33, kb-client 5, untrusted 3).
- `vitest run src/internal/copilot`: 176 verdes, 8 skip (EXPLAIN 50k do S06), **1 vermelho esperado**: `core/registry.test.ts` "o registro de produção compõe sem erro, com chaves únicas e só as 8 consultas de read-crm" — afirma exatamente as 8 do S06; com as 6 deste slot registradas o conjunto passa a ter 14 consultas. Arquivo fora da fronteira: ajuste do orchestrator na integração.
- `vitest run src/services/copilot/turns src/services/copilot/identity`: 8 arquivos / 67 verdes.

Lacunas de contrato (`@hm/shared`, não estendido):
- `CampaignCardDataSchema` não tem o número de "agendadas"/ainda por enviar: vai só no `model_view` (`pending`).
- `cost_used` sem fonte de dado (ver acima).
- `ConversationListDataSchema` não tem campo de "não lidas" nem de departamento; não enviados.
