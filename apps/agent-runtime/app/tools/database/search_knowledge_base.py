"""Tool `search_knowledge_base` — RAG sobre a base de conhecimento (§7.3, §12.2).

**STUB até F3.** A ingestão (embeddings) e o retrieval pgvector reais entram em
F3. Aqui declaramos o contrato (args + schema + categoria) e devolvemos um
resultado vazio explícito, para que agentes seed que referenciam a tool não
quebrem e o modelo saiba que a base ainda não respondeu.

Categoria `knowledge` (não `database`): o retrieval real fará embedding via OpenAI
direto + cosine pgvector — não é um SELECT de coluna comum, então NÃO subclassifica
`DatabaseTool` (sem ACL de coluna). Fica como `Tool` puro.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.base import Tool, ToolContext, ToolResult


class SearchKnowledgeBaseArgs(BaseModel):
    query: str = Field(description="Pergunta/consulta em linguagem natural.")
    k: int = Field(default=5, ge=1, le=20, description="Quantos trechos retornar.")


class SearchKnowledgeBaseTool(Tool):
    key = "search_knowledge_base"
    name = "Buscar na base de conhecimento"
    description = (
        "Busca trechos relevantes na base de conhecimento do workspace (RAG). "
        "Use antes de responder sobre produtos/políticas."
    )
    category = "knowledge"
    table = None
    Args = SearchKnowledgeBaseArgs

    async def _run(self, args: SearchKnowledgeBaseArgs, ctx: ToolContext) -> ToolResult:
        # Stub determinístico até F3 (pgvector + embeddings). Não levanta; sinaliza
        # ao modelo que a base ainda não está disponível, sem inventar dados.
        return ToolResult(
            ok=True,
            content=(
                "A base de conhecimento ainda não foi indexada (disponível a partir da F3). "
                "Nenhum trecho encontrado."
            ),
            payload={"results": [], "indexed": False},
        )
