"""Node `load_context`: carrega agent/contact/conversation do DB sob RLS.

> **Slot:** F2-S05 — `docs/AGENTS_LANGGRAPH.md` §3.2, §4.1.

Lê o contexto necessário para montar o prompt. Toda leitura passa por
`with_workspace(conn, workspace_id)` (papel `hm_app` + `app.workspace_id`), então
a RLS garante isolamento multi-tenant — nenhuma query atravessa workspaces.

Defesa-em-profundidade de policy (do doc §8.2): corta as tools fora das categorias
permitidas e aplica `max_tools_per_agent`, mesmo o Node já tendo filtrado. Se o
modelo do agente não está na whitelist da policy, marca `model_blocked_reason` (o
`call_model` então pula a chamada e o `/run` emite `model_blocked`).

O node é uma fábrica: recebe o `pool` asyncpg para ficar testável (injeta fake) e
para não depender do singleton global nos testes de lógica do grafo.
"""

from __future__ import annotations

from typing import Any

import asyncpg

from app.db import with_workspace
from app.logging import get_logger
from app.policy import apply_policy
from app.types import AgentState, PolicySnapshot

logger = get_logger()

# Quantas mensagens recentes carregar para rotular autoria na retomada (handoff).
# Enxuto de propósito: o prompt não deve inchar com o histórico inteiro (custo/tokens).
_MAX_AUTHORED_HISTORY = 20

# `messages.sender_type` ∈ ('contact','member','agent','system') (DATA_MODEL §6.4) →
# autoria semântica que a IA enxerga (LIVECHAT_OPS §2): `member` é o atendente HUMANO.
_SENDER_TYPE_TO_AUTHOR: dict[str, str] = {
    "contact": "contact",
    "member": "human",
    "agent": "ai",
    "system": "system",
}


def _author_role(sender_type: str | None) -> str:
    """Mapeia `messages.sender_type` para a autoria (`human|ai|contact|system`)."""
    return _SENDER_TYPE_TO_AUTHOR.get(sender_type or "", "ai")


async def _load_agent(conn: asyncpg.Connection, agent_id: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT id::text, name, model, model_params, system_prompt,
               COALESCE(model_supports_vision, false) AS model_supports_vision
        FROM agents
        WHERE id = $1::uuid
        """,
        agent_id,
    )
    if row is None:
        raise LookupError(f"agent {agent_id} não encontrado no workspace")
    agent = dict(row)
    # model_params é JSONB; normaliza para dict.
    params = agent.get("model_params")
    agent["model_params"] = params if isinstance(params, dict) else {}
    return agent


async def _load_contact(conn: asyncpg.Connection, contact_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT id::text, display_name, custom_fields
        FROM contacts
        WHERE id = $1::uuid
        """,
        contact_id,
    )
    return dict(row) if row else None


async def _load_conversation(
    conn: asyncpg.Connection, conversation_id: str
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT id::text, status, channel_provider, kind, ai_paused_reason
        FROM conversations
        WHERE id = $1::uuid
        """,
        conversation_id,
    )
    return dict(row) if row else None


async def _load_authored_history(
    conn: asyncpg.Connection, conversation_id: str
) -> list[dict[str, Any]]:
    """Carrega as mensagens recentes da conversa com a AUTORIA de cada uma.

    Retorna em ordem cronológica (mais antiga → mais nova) `{author_role, content}`.
    Exclui mensagens de sistema e deletadas. A autoria deriva de `sender_type`
    (`member` = atendente humano), base da retomada consciente (LIVECHAT_OPS §2).
    """
    rows = await conn.fetch(
        """
        SELECT sender_type, content
        FROM messages
        WHERE conversation_id = $1::uuid
          AND deleted_at IS NULL
          AND sender_type <> 'system'
        ORDER BY created_at DESC
        LIMIT $2
        """,
        conversation_id,
        _MAX_AUTHORED_HISTORY,
    )
    authored = [
        {"author_role": _author_role(r["sender_type"]), "content": r["content"]}
        for r in reversed(rows)
    ]
    return authored


def make_load_context_node(pool: asyncpg.Pool):
    """Fábrica do node `load_context`, ligada a um pool asyncpg."""

    async def load_context_node(state: AgentState) -> dict[str, Any]:
        workspace_id = state["workspace_id"]
        policy: PolicySnapshot = state["policy"]

        async with pool.acquire() as conn:
            async with with_workspace(conn, workspace_id) as scoped:
                agent = await _load_agent(scoped, state["agent_id"])
                contact = (
                    await _load_contact(scoped, state["contact_id"])
                    if state.get("contact_id")
                    else None
                )
                conversation = (
                    await _load_conversation(scoped, state["conversation_id"])
                    if state.get("conversation_id")
                    else None
                )
                # Retomada consciente de contexto (F30-S05 / LIVECHAT_OPS §2): rotula a
                # autoria do histórico e detecta se um humano assumiu a conversa. Mantido
                # dentro do dict `conversation` (canal existente) — sem mudar o schema do
                # state. `build_prompt` consome `human_takeover`/`authored_history`.
                if conversation is not None:
                    authored = await _load_authored_history(scoped, state["conversation_id"])
                    human_takeover = any(m["author_role"] == "human" for m in authored) or (
                        conversation.get("ai_paused_reason") == "human_takeover"
                    )
                    conversation["authored_history"] = authored
                    conversation["human_takeover"] = human_takeover

        decision = apply_policy(state.get("tools", []), agent["model"], policy)

        patch: dict[str, Any] = {
            "agent": agent,
            "contact": contact,
            "conversation": conversation,
            "tools": decision.tools,
            "iteration": 0,
        }

        # Defesa-em-profundidade: modelo fora da whitelist é bloqueado aqui.
        if decision.model_blocked_reason is not None:
            patch["model_blocked_reason"] = decision.model_blocked_reason
            logger.warning(
                "load_context: modelo bloqueado por policy",
                workspace_id=workspace_id,
                model=str(agent["model"]),
            )

        logger.debug(
            "load_context ok",
            workspace_id=workspace_id,
            tools=len(decision.tools),
            has_contact=contact is not None,
            has_conversation=conversation is not None,
            human_takeover=bool(conversation and conversation.get("human_takeover")),
        )
        return patch

    return load_context_node
