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
        SELECT id::text, status, channel_provider, kind
        FROM conversations
        WHERE id = $1::uuid
        """,
        conversation_id,
    )
    return dict(row) if row else None


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
        )
        return patch

    return load_context_node
