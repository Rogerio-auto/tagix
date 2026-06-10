"""Tools "leves" de DB do agent-runtime (F2-S06).

Exporta as classes de tool e a fábrica `build_light_db_tools(pool)`, consumida
por `registry.build_default_registry`.
"""

from __future__ import annotations

import asyncpg

from app.tools.base import Tool
from app.tools.database.base import DatabaseTool
from app.tools.database.query_contact import QueryContactTool
from app.tools.database.query_conversation import QueryConversationTool
from app.tools.database.search_knowledge_base import SearchKnowledgeBaseTool

__all__ = [
    "DatabaseTool",
    "QueryContactTool",
    "QueryConversationTool",
    "SearchKnowledgeBaseTool",
    "build_light_db_tools",
]


def build_light_db_tools(pool: asyncpg.Pool) -> list[Tool]:
    """Instancia as tools leves de F2-S06 com o pool asyncpg injetado.

    `search_knowledge_base` é stub (sem pool: não toca DB até F3) — mas é uma tool
    leve de leitura conceitualmente, então fica neste pacote.
    """
    return [
        QueryContactTool(pool),
        QueryConversationTool(pool),
        SearchKnowledgeBaseTool(),
    ]
