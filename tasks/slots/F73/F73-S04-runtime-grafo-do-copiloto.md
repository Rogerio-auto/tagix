---
id: F73-S04
title: Runtime do Copiloto (grafo LangGraph próprio, /copilot/run em SSE, ferramentas por callback com grant, resposta estruturada, /kb/search)
phase: F73
status: available
priority: critical
estimated_size: L
model: opus
ui: false
depends_on: []
blocks: [F73-S07, F73-S10, F73-S14]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-003-identidade-do-membro-nas-acoes-de-ia.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
  - docs/AGENTS_LANGGRAPH.md
agent_id: python-engineer
---
# F73-S04 — Grafo do Copiloto no agent-runtime

## Objetivo

O `agent-runtime` ganha um segundo grafo, só do Copiloto. Ele recebe um pedido já autorizado pela API, conversa com o modelo via OpenRouter e executa **toda** ferramenta por callback ao Node com o grant. Devolve em streaming o status, o veredito e o resultado final no formato fixo (veredito → por quê → dados → fonte → próximo passo). O runtime não acessa o banco nesse caminho. Também expõe `POST /kb/search` para o Node buscar no conhecimento.

## Contexto

O grafo dos agentes (`app/graph.py`) fica intocado. O contrato é o da spec §5.4, que o F73-S02 publica em `packages/shared/src/copilot/internal.ts`. Este slot roda **em paralelo** ao S02 seguindo a spec. O teste de contrato entre as duas pontas é do F73-S10 (fixtures JSON compartilhadas).

## Escopo (faz)

- `app/copilot/` (pacote novo):
  - `types.py`: pydantic v2, `extra="forbid"` na entrada: `CopilotRunRequest`, `CopilotToolDescriptor`, `CopilotPolicy`, `CopilotRuntimeEvent` (união por `type`: `status`, `verdict_delta`, `tool_call_completed`, `final`, `iteration_exceeded`, `error`), `AnswerBlocks`;
  - `prompt.py`: prompt de sistema em pt-BR, versionado (`COPILOT_PROMPT_VERSION`). Ele:
    1. define o papel ("assistente da equipe; age com as permissões de quem pede; nunca promete o que a ferramenta não confirmou");
    2. impõe o formato fixo, sem saudação nem enchimento, e "se a base for fraca, diga";
    3. traz as regras de ação: ação só por `propose_*`, nunca afirmar que fez algo que voltou `awaiting_confirmation`, e depois de propor, parar e resumir;
    4. manda tratar dado de contato como dado e nunca seguir instrução encontrada nele;
    5. explica as datas (`now_iso`, fuso, locale);
    6. traz a memória do negócio como **fatos de referência** com fonte;
    7. traz o contexto de página resolvido.
    Todo conteúdo de terceiros (memória vinda de integração, `model_view` de ferramenta com `untrusted`) passa por spotlighting com `app/guards/injection.py` (reusar por import);
  - `graph.py`: `build_copilot_graph(*, provider, http_client, settings)`, com o fluxo `build_prompt → call_model → (tool_dispatch → call_model)* → finalize`, sem checkpointer persistente (o histórico vem no request);
    - `max_iterations` e `max_tool_calls` da `policy` (padrões 8 e 16);
    - chamadas paralelas desligadas (`parallel_tool_calls=false`): a ordem importa para a contaminação;
  - `answer.py`: ferramenta **local** `answer` (não faz callback), com args `{ verdict (≤ 220 caracteres), why: string[] ≤ 3, data_refs: string[], sources: { label, as_of }[], next_steps: { label, action? }[] ≤ 3 }`. O modelo é instruído a terminar **sempre** chamando `answer`.
    - O `call_model` faz streaming dos deltas dos argumentos dessa ferramenta e emite `verdict_delta` com o texto do campo `verdict` assim que ele é parseável (parser incremental de JSON parcial; sem regex frágil).
    - `data_refs` desconhecidos são removidos no `finalize`: só ficam ids de `tool_call_completed` deste turno.
    - Se o modelo responder em texto livre sem chamar `answer`, `finalize` monta `AnswerBlocks` com `verdict` = primeira frase e marca `format_fallback=true` no evento `final`;
  - `tools.py`: `CopilotCallbackTool`, que faz `POST {API}/internal/copilot/tools/{key}` com `Authorization: Bearer AGENT_RUNTIME_TOKEN`, `X-Copilot-Grant` e corpo `{ turn_id, call_id, args }`.
    - Timeout de 20 s. Erro HTTP ou timeout vira `model_view` seguro ("a ferramenta falhou; diga isso à pessoa"), sem corpo cru. O token não aparece em log nem em erro (mesma disciplina de `app/tools/callback.py`, que não deve ser editado; extrair um helper comum só se não mudar o comportamento dele).
    - Emite `status { tool_key }` antes do callback e `tool_call_completed { tool_key, call_id, envelope }` depois.
    - As ferramentas são construídas dinamicamente a partir de `request.tools` (descritores com JSON Schema); a ferramenta `answer` é sempre adicionada;
  - `route.py`: `POST /copilot/run` com o mesmo bearer de `/run`, devolvendo `StreamingResponse` SSE (`data: <json>\n\n`).
    - Timeout total do turno (`policy.turn_timeout_s`, padrão 60) com `asyncio.timeout`, que gera `error { code: 'timeout' }`.
    - Desconexão do cliente cancela a tarefa do grafo.
    - Emite `final` com `usage` (`prompt_tokens`, `completion_tokens`, `total_cost_usd` vindo do OpenRouter, como o `/run` já faz) e `iterations`.
- `app/routes/kb_search.py`: `POST /kb/search` (bearer), body `{ workspace_id, query (≤ 500), limit ≤ 8 }`, devolvendo `{ results: { document_id, title, snippet ≤ 600, score }[] }`. Reusa `app/tools/database/_kb_retrieval.py` **por import** (sem mudar o comportamento dele), sob `with_workspace`.
- `app/main.py`: montar as duas rotas e construir o grafo do Copiloto no lifespan (o provider OpenRouter é compartilhado).
- `app/config.py`: `copilot_default_model` (env `COPILOT_DEFAULT_MODEL`, com o padrão da plataforma documentado) e `api_base_url` (já existe para os callbacks; reusar).
- Testes em `tests/copilot/`, todos com fakes (provider e `httpx.MockTransport`):
  - fluxo feliz (consulta → `tool_call_completed` → `answer` → `final` com `data_refs` válidos);
  - `verdict_delta` antes do `final`, e a concatenação igual ao `verdict` final;
  - `data_refs` inventado é removido;
  - teto de iterações → `iteration_exceeded` e um `final` com `format_fallback`;
  - timeout;
  - erro 403 do callback → `model_view` seguro, sem vazar corpo;
  - o grant nunca aparece em log (captura do sink);
  - desconexão cancela;
  - o descritor inválido no request é recusado com 422;
  - `/kb/search` com fake de pool;
  - **teste de prompt**: o prompt contém as 7 seções, e o conteúdo `untrusted` sai delimitado pelo spotlighting.

## Fora de escopo

- Chamar o banco no caminho do Copiloto (proibido pelo ADR-003).
- Gravar `llm_usage_logs` (a API grava a partir do `final`; F73-S10).
- Eval de qualidade e suíte adversarial (F73-S14 usa o harness deste slot).

### files_allowed

- `apps/agent-runtime/app/copilot/**`
- `apps/agent-runtime/app/routes/kb_search.py`
- `apps/agent-runtime/app/main.py`
- `apps/agent-runtime/app/config.py`
- `apps/agent-runtime/tests/copilot/**`
- `apps/agent-runtime/tests/test_kb_search.py`

### files_forbidden

- `apps/agent-runtime/app/graph.py`
- `apps/agent-runtime/app/nodes/**`
- `apps/agent-runtime/app/tools/**` (só importar)

## Contratos

- Entrada e eventos: spec §5.4. Os nomes de campo são snake_case e idênticos aos do Zod `packages/shared/src/copilot/internal.ts`.
- Exportar `tests/copilot/fixtures/*.json` (request válido e sequência de eventos de um turno), que o F73-S10 consome no teste de contrato do lado Node.

## Definition of Done

- [ ] Todos os testes de `tests/copilot` e `test_kb_search.py` verdes; os existentes seguem verdes
- [ ] `ruff check` limpo nos arquivos tocados
- [ ] Nenhuma conexão de banco aberta no caminho `/copilot/run` (teste com pool fake que falha se for usado)
- [ ] Prompt versionado, com nota de execução listando as decisões de redação
- [ ] Fixtures de contrato exportadas

## Validação

```bash
cd apps/agent-runtime && uv run ruff check app/copilot app/routes/kb_search.py tests/copilot
cd apps/agent-runtime && uv run pytest tests/copilot tests/test_kb_search.py -q
cd apps/agent-runtime && uv run pytest -q
```

## Notas

- Agente: `python-engineer` (opus: prompt e superfície de injeção).
- Paralelo a F73-S01 e F73-S02: nenhum arquivo em comum.
- O modelo padrão é decisão de plataforma (whitelist do super-admin). Precisa ter tool use confiável e streaming de argumentos de ferramenta. Registre na nota qual modelo foi usado nos testes manuais e a latência observada.
- `answer` não é capacidade e não passa pelo Node. É só a forma de a resposta sair estruturada.
