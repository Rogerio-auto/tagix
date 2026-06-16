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
from app.types import AgentState, PolicySnapshot, ToolDescriptor

logger = get_logger()

# Key da tool de transferência autônoma IA→IA (espelha o handler Node de F34-S05).
_TRANSFER_TO_AGENT_KEY = "transfer_to_agent"

# Quantas mensagens recentes carregar para rotular autoria na retomada (handoff).
# Enxuto de propósito: o prompt não deve inchar com o histórico inteiro (custo/tokens).
_MAX_AUTHORED_HISTORY = 20

# Limite defensivo de pares listados no prompt (custo/tokens; um dept com dezenas de
# agentes não deve inchar o prompt). O Node revalida a authz de alvo de qualquer forma.
_MAX_PEERS = 20

# `messages.sender_type` ∈ ('contact','member','agent','system') (DATA_MODEL §6.4) →
# autoria semântica que a IA enxerga (LIVECHAT_OPS §2): `member` é o atendente HUMANO.
# `agent` é genérico (qualquer agente de IA); a distinção "você" vs "outro agente de IA"
# é feita por `_author_role` comparando o `sender_id` com o agente ATUAL da execução.
_SENDER_TYPE_TO_AUTHOR: dict[str, str] = {
    "contact": "contact",
    "member": "human",
    "agent": "ai",
    "system": "system",
}


def _author_role(sender_type: str | None, *, is_current_agent: bool = True) -> str:
    """Mapeia `messages.sender_type` para a autoria que a IA enxerga.

    `human|ai|contact|system`, mais `ai_other` para turnos de OUTRO agente de IA
    (sender_type='agent' cujo `sender_id` difere do agente atual). Distinguir IA
    atual de IA anterior alimenta o contexto de handoff IA→IA (F34-S06).
    """
    role = _SENDER_TYPE_TO_AUTHOR.get(sender_type or "", "ai")
    if role == "ai" and not is_current_agent:
        return "ai_other"
    return role


async def _load_agent(conn: asyncpg.Connection, agent_id: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT id::text, name, model, model_params, system_prompt,
               COALESCE(model_supports_vision, false) AS model_supports_vision,
               COALESCE(allow_handoff, false) AS allow_handoff
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
    conn: asyncpg.Connection, conversation_id: str, current_agent_id: str
) -> list[dict[str, Any]]:
    """Carrega as mensagens recentes da conversa com a AUTORIA de cada uma.

    Retorna em ordem cronológica (mais antiga → mais nova) `{author_role, content}`.
    Exclui mensagens de sistema e deletadas. A autoria deriva de `sender_type`
    (`member` = atendente humano), base da retomada consciente (LIVECHAT_OPS §2).
    Para turnos de IA (`sender_type='agent'`), compara `sender_agent_id` com o agente
    ATUAL: igual → `ai` (você); diferente → `ai_other` (outro agente de IA), o que
    alimenta o contexto de handoff IA→IA (F34-S06).
    """
    rows = await conn.fetch(
        """
        SELECT sender_type, sender_agent_id::text AS sender_agent_id, content
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
        {
            "author_role": _author_role(
                r["sender_type"],
                is_current_agent=r["sender_agent_id"] in (None, current_agent_id),
            ),
            "content": r["content"],
        }
        for r in reversed(rows)
    ]
    return authored


async def _load_peers(conn: asyncpg.Connection, agent_id: str) -> list[dict[str, Any]]:
    """Carrega os PARES de handoff do agente: agentes que compartilham ≥1 departamento.

    Espelha a authz de alvo do Node (`areAgentsInSameDepartment`, F34-S05): o runtime
    só lista no prompt agentes para os quais a transferência seria de fato aceita —
    sem prometer ao LLM um destino que o Node rejeitaria. Roda sob a mesma scope RLS
    de `load_context`. Retorna `{id, name, department, description}` por par, ordenado
    e deduplicado (um par pode dividir vários depts).

    `agent_departments` é a junção N:N de F34-S01; `departments` dá o nome legível.
    """
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (a.id)
               a.id::text AS id,
               a.name AS name,
               a.description AS description,
               d.name AS department
        FROM agent_departments AS mine
        JOIN agent_departments AS theirs
          ON theirs.department_id = mine.department_id
         AND theirs.agent_id <> mine.agent_id
        JOIN agents AS a
          ON a.id = theirs.agent_id
         AND a.status = 'active'
        JOIN departments AS d
          ON d.id = theirs.department_id
        WHERE mine.agent_id = $1::uuid
        ORDER BY a.id, d.name
        LIMIT $2
        """,
        agent_id,
        _MAX_PEERS,
    )
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "department": r["department"],
            "description": r["description"],
        }
        for r in rows
    ]


def _gate_transfer_to_agent(
    tools: list[ToolDescriptor], handoff_enabled: bool
) -> list[ToolDescriptor]:
    """Remove `transfer_to_agent` da lista exposta ao LLM quando o handoff está OFF.

    Quando habilitado, mantém a lista como veio (o Node já decidiu se o agente tem a
    tool ligada). Quando desabilitado (`allow_handoff=false` ou sem pares), a tool é
    filtrada — o LLM nunca a vê. Idempotente e não-mutante.
    """
    if handoff_enabled:
        return tools
    return [t for t in tools if t.key != _TRANSFER_TO_AGENT_KEY]


def make_load_context_node(pool: asyncpg.Pool):
    """Fábrica do node `load_context`, ligada a um pool asyncpg."""

    async def load_context_node(state: AgentState) -> dict[str, Any]:
        workspace_id = state["workspace_id"]
        policy: PolicySnapshot = state["policy"]

        peers: list[dict[str, Any]] = []

        async with pool.acquire() as conn:
            async with with_workspace(conn, workspace_id) as scoped:
                agent = await _load_agent(scoped, state["agent_id"])
                allow_handoff = bool(agent.get("allow_handoff"))
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
                    authored = await _load_authored_history(
                        scoped, state["conversation_id"], state["agent_id"]
                    )
                    human_takeover = any(m["author_role"] == "human" for m in authored) or (
                        conversation.get("ai_paused_reason") == "human_takeover"
                    )
                    conversation["authored_history"] = authored
                    conversation["human_takeover"] = human_takeover

                # Pares de handoff IA→IA (F34-S06): só consulta quando o agente permite
                # handoff — evita a query de junção quando a feature está desligada.
                if allow_handoff:
                    peers = await _load_peers(scoped, state["agent_id"])

        decision = apply_policy(state.get("tools", []), agent["model"], policy)

        # Gate de handoff IA→IA (F34-S06): a tool `transfer_to_agent` só é exposta ao
        # LLM quando o agente tem `allow_handoff=true` E há ≥1 par disponível. Sem isso,
        # o LLM nunca enxerga a tool (defesa-em-profundidade: o Node revalida a authz).
        # `agent.allow_handoff` é a expressão do owner; `peers` é a realidade do dept.
        handoff_enabled = allow_handoff and bool(peers)
        gated_tools = _gate_transfer_to_agent(decision.tools, handoff_enabled)

        # Expõe a config de handoff ao `build_prompt` (canal existente do `agent`),
        # sem mudar o schema do state. Apenas quando habilitado de fato.
        agent["allow_handoff"] = handoff_enabled
        agent["handoff_peers"] = peers if handoff_enabled else []

        patch: dict[str, Any] = {
            "agent": agent,
            "contact": contact,
            "conversation": conversation,
            "tools": gated_tools,
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
            tools=len(gated_tools),
            has_contact=contact is not None,
            has_conversation=conversation is not None,
            human_takeover=bool(conversation and conversation.get("human_takeover")),
            handoff_enabled=handoff_enabled,
            peers=len(peers),
        )
        return patch

    return load_context_node
