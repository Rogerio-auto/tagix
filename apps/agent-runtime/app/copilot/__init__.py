"""Copiloto (F73-S04): segundo grafo do agent-runtime, isolado do grafo dos agentes.

> **source:** `docs/features/COPILOTO.md` §3, §5.4, §8 · ADR-003 · ADR-004.

O Copiloto recebe um pedido já autorizado pela API (`POST /copilot/run`), conversa com
o modelo via OpenRouter e executa **toda** ferramenta por callback ao Node com o grant
do turno. Nada neste pacote abre conexão com o banco (ADR-003 §6): o escopo fino do
membro vive no Node. Módulos:

- `types`: contrato interno API ↔ runtime (request, eventos, blocos da resposta);
- `prompt`: prompt de sistema versionado + spotlighting de conteúdo de terceiros;
- `partial_json`: parser incremental de JSON parcial (streaming do `verdict`);
- `answer`: ferramenta local `answer` (formato fixo da resposta) e fallback;
- `tools`: `CopilotCallbackTool` (callback HTTP com grant);
- `graph`: `build_copilot_graph(...)`;
- `route`: `POST /copilot/run` (SSE).
"""
