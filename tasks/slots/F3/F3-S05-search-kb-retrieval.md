---
id: F3-S05
title: Tool search_knowledge_base — retrieval híbrido (vetor + FTS) + ranking + citações
phase: F3
status: done
priority: high
estimated_size: M
depends_on: [F3-S01, F3-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T16:18:59Z
completed_at: 2026-06-10T16:22:37Z

---
# F3-S05 — search_knowledge_base (retrieval real)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §7.3, §12.2; `docs/DATA_MODEL.md` §8.2; `docs/ROADMAP.md` F3-S03
> **blocks:** F3-S07

## Objetivo
Substituir o **stub** de `search_knowledge_base` por retrieval real: embed da query (via `EmbeddingsProvider` de F3-S02, in-process), busca vetorial cosine (HNSW) com fallback/boost de FTS português, ranking combinado por similaridade × `kb_documents.priority` × sinal de `kb_feedback`, respeitando `visible_to_agents` e RLS de workspace. Retorna trechos **com citações** (`document_id`, `chunk_id`, título, score).

## Escopo (faz)
- `apps/agent-runtime/app/tools/database/search_knowledge_base.py`: implementar `_run` real —
  - embed da `query` via `EmbeddingsProvider`;
  - SQL asyncpg sob `with_workspace`: `ORDER BY embedding <=> $1` (cosine) `LIMIT k*`, filtrando `kb_documents.status='active' AND visible_to_agents` e join para `priority`;
  - re-rank: combinar distância vetorial + `ts_rank` FTS pt + priority + agregado de feedback (`helpful` count) → top-`k`;
  - `ToolResult.payload = { results: [{ document_id, chunk_id, title, content, score }], indexed: true }` e `content` legível para o modelo (trechos + fontes).
- `apps/agent-runtime/app/tools/database/_kb_retrieval.py` (helper opcional de query/ranking), se ajudar a testar.

## Fora de escopo
- Gerar embeddings / endpoint (F3-S02), ingestão (F3-S03), schema (F3-S01), UI de feedback (F3-S07).

## Arquivos permitidos
- `apps/agent-runtime/app/tools/database/search_knowledge_base.py`
- `apps/agent-runtime/app/tools/database/_kb_retrieval.py`

## Contratos de saída
- `payload.results[]` com `document_id` e `chunk_id` — **contrato de citação** consumido por F3-S07 (feedback) e pela UI.
- Mantém `key='search_knowledge_base'`, `category='knowledge'`, e o `Args` (`query`, `k`) já fixados em F2-S06.

## Definition of Done
- [ ] Retrieval retorna top-`k` por similaridade cosine sob RLS, só docs `active`+`visible_to_agents`.
- [ ] Ranking combina vetor + FTS pt + `priority` (+ feedback se houver); base vazia → `{ results: [], indexed: true }` sem erro.
- [ ] Resultado carrega `document_id`/`chunk_id` para citação.
- [ ] `ruff` + `pytest` (asyncpg + embeddings mockados) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
- Especialista sugerido: **python-engineer**.
- Continua `Tool` puro (não `DatabaseTool`) — sem ACL de coluna, como o stub já documenta.
- Custo do embed da query também entra em `llm_usage_logs(request_type='embedding')` (reusa F3-S02).
