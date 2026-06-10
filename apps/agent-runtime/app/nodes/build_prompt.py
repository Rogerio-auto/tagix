"""Node `build_prompt`: monta system prompt + histórico + turno novo.

> **Slot:** F2-S05 — `docs/AGENTS_LANGGRAPH.md` §3.2, §9.

Node PURO (sem IO). Constrói o system prompt a partir do agent + contact +
conversation + política de uso de tools, recorta o histórico recente (últimos 12
turnos não-system) e anexa o `user_input` do turno atual.

Importante sobre o reducer `add_messages` do state: ele ANEXA, não substitui.
Para não duplicar/conflitar, este node é executado **uma única vez** no início do
grafo (antes do loop). Ele monta a lista canônica `[system, ...recent, user]` e a
emite. Como o estado entra "limpo" (sem mensagens prévias salvas além do que veio
no request), o resultado é o conjunto inicial de mensagens da execução.
"""

from __future__ import annotations

import json
from typing import Any

from app.logging import get_logger
from app.types import AgentState, ChatMessage

logger = get_logger()

_MAX_HISTORY = 12


def _system_prompt(state: AgentState) -> str:
    agent = state.get("agent") or {}
    parts: list[str] = []

    base = agent.get("system_prompt")
    if base:
        parts.append(str(base))

    contact = state.get("contact")
    if contact:
        name = contact.get("display_name") or "um cliente"
        parts.append(f"Você está conversando com {name}.")
        custom = contact.get("custom_fields")
        if custom:
            # custom_fields pode ser dict (JSONB) — serializa de forma estável.
            try:
                parts.append(f"Dados do contato: {json.dumps(custom, ensure_ascii=False)}")
            except (TypeError, ValueError):
                pass

    conversation = state.get("conversation")
    if conversation:
        channel = conversation.get("channel_provider", "desconhecido")
        cstatus = conversation.get("status", "desconhecido")
        parts.append(f"Canal: {channel}. Status: {cstatus}.")
        if conversation.get("kind") == "comment_thread":
            parts.append(
                "Você está respondendo um comentário em um post/reel do Instagram. "
                "Avalie se a resposta deve ser pública (visível a todos) ou privada "
                "(comment-to-DM). Não esconda comentários a menos que sejam "
                "claramente spam ou ofensivos."
            )

    tools = state.get("tools") or []
    if tools:
        parts.append("POLÍTICA DE USO DE FERRAMENTAS:")
        parts.append("- Use ferramentas quando a intenção indica ação concreta.")
        parts.append("- Não anuncie que vai usar ferramenta; use direto.")
        parts.append("- Se a ação requer dados ausentes, pergunte ao usuário.")
        if any(t.key == "search_knowledge_base" for t in tools):
            parts.append(
                "Antes de inventar uma resposta sobre o produto, sempre busque na "
                "base de conhecimento."
            )

    return "\n\n".join(parts)


async def build_prompt_node(state: AgentState) -> dict[str, Any]:
    """Monta a lista inicial de mensagens da execução.

    Lê o histórico de `state["history"]` (semeado pelo request, NÃO acumulado pelo
    reducer) e o `user_input`. Emite `[system, ...recent, user]` para `messages`.
    Como `messages` entra vazio na primeira passagem, o reducer `add_messages`
    apenas adiciona esta lista canônica; nodes seguintes anexam por cima.
    """
    history = state.get("history") or []
    recent = [m for m in history if m.role != "system"][-_MAX_HISTORY:]

    messages: list[ChatMessage] = [
        ChatMessage(role="system", content=_system_prompt(state)),
        *recent,
        ChatMessage(role="user", content=state["user_input"]),
    ]

    logger.debug("build_prompt ok", messages=len(messages), recent=len(recent))
    return {"messages": messages}
