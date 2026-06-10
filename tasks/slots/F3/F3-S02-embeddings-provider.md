---
id: F3-S02
title: Embeddings provider (OpenAI direto) + endpoint interno /embed + usage logging
phase: F3
status: in-progress
priority: critical
estimated_size: S
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-10T16:06:00Z

---
# F3-S02 — Embeddings provider (OpenAI direto)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §12.2; `docs/DATA_MODEL.md` §11 (`llm_usage_logs`, `request_type='embedding'`), §8.2 (`vector(1536)`); `docs/ROADMAP.md` F3-S02 (parte embeddings)
> **blocks:** F3-S03, F3-S05

## Objetivo
Primitivo de embeddings do RAG: um `EmbeddingsProvider` Python que chama a **OpenAI direto** (`text-embedding-3-small`, 1536 dims — OpenRouter NÃO roteia embeddings) com batching, e um endpoint interno `POST /internal/embed` (token-auth) que o worker de ingestão (Node, F3-S03) consome. Registra custo em `llm_usage_logs` com `request_type='embedding'`.

## Escopo (faz)
- `apps/agent-runtime/app/providers/embeddings.py`: `EmbeddingsProvider.embed(texts: list[str]) -> list[list[float]]` via `httpx.AsyncClient` na API OpenAI `/v1/embeddings`; batching + retry/backoff; captura tokens/custo.
- `apps/agent-runtime/app/routes/embed.py`: `POST /internal/embed` — autentica com `AGENT_RUNTIME_TOKEN` (mesmo esquema do callback interno), valida body `{ workspace_id, texts: string[] }`, devolve `{ embeddings: number[1536][], model, usage }` e grava `llm_usage_logs(request_type='embedding')`.
- `apps/agent-runtime/app/config.py` (ou equivalente): `OPENAI_API_KEY`, `EMBEDDING_MODEL` (default `text-embedding-3-small`), `EMBEDDING_DIM=1536`.
- `apps/agent-runtime/app/main.py`: montar o router de embed.
- `.env.example`: adicionar `OPENAI_API_KEY` + `EMBEDDING_MODEL`.

## Fora de escopo
- Chunking/persistência (F3-S03), busca vetorial (F3-S05). Este slot só **gera** vetores e os expõe.

## Arquivos permitidos
- `apps/agent-runtime/app/providers/embeddings.py`
- `apps/agent-runtime/app/routes/embed.py`
- `apps/agent-runtime/app/config.py`
- `apps/agent-runtime/app/main.py`
- `.env.example`

## Contratos de saída
- **Provider (Python, consumido por F3-S05 in-process):** `EmbeddingsProvider.embed(texts) -> list[list[float]]`, vetores de dimensão 1536.
- **HTTP (consumido por F3-S03 via fetch):** `POST /internal/embed` → `200 { embeddings: number[][], model: string, usage: { total_tokens, total_cost_usd } }`. Auth: header `Authorization: Bearer <AGENT_RUNTIME_TOKEN>`. Erros: 401 sem token, 400 body inválido, 502 falha upstream.

## Definition of Done
- [ ] `EmbeddingsProvider.embed` retorna vetores 1536-dim (teste com cliente OpenAI mockado).
- [ ] `POST /internal/embed` autentica, valida e grava `llm_usage_logs(request_type='embedding')`.
- [ ] `ruff` + `pytest` (httpx mockado) verdes.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
```

## Notas
- Especialista sugerido: **python-engineer**.
- Modelo de embedding é **decisão travada** (DATA_MODEL §8.2/§11): OpenAI `text-embedding-3-small` direto, fora do OpenRouter. Isole atrás do `EmbeddingsProvider` para troca futura.
- A dimensão 1536 é contrato rígido com a coluna `vector(1536)` de F3-S01 — não mude sem migration.
