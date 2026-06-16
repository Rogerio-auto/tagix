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

# Rótulos legíveis por autoria (LIVECHAT_OPS §2). `ai` é a própria IA em turnos
# anteriores; `ai_other` é OUTRO agente de IA que atendeu antes (handoff IA→IA, F34);
# `human` é o atendente que assumiu; `contact` é o cliente.
_AUTHOR_LABELS: dict[str, str] = {
    "contact": "Cliente",
    "human": "Atendente humano",
    "ai": "IA (você, em turnos anteriores)",
    "ai_other": "Outro agente de IA",
    "system": "Sistema",
}

# Diretriz curta e objetiva de retomada (enxuta de propósito — custo/tokens).
_HANDOFF_DIRECTIVE = (
    "RETOMADA DE CONVERSA: um atendente humano assumiu parte desta conversa. "
    "Retome com consciência disso — não repita o que o humano já disse nem reinicie "
    "o atendimento do zero. Conforme o caso, encerre, faça follow-up do que ficou "
    "pendente ou reengaje o cliente."
)

# Diretriz curta de transferência IA→IA (F34-S06). Acionável: o LLM decide e chama
# `transfer_to_agent`. A authz de alvo (same-dept) + `max_iterations` contêm abuso.
_HANDOFF_TO_AGENT_DIRECTIVE = (
    "TRANSFERÊNCIA PARA OUTRO AGENTE: se o assunto é melhor atendido por um dos "
    "agentes abaixo, use a ferramenta `transfer_to_agent` com o `targetAgentId` dele "
    "e um `reason` curto. Só transfira quando for claramente o agente certo; depois de "
    "transferir, não responda mais. Não transfira de volta para si mesmo nem em loop."
)


def _handoff_block(conversation: dict[str, Any]) -> str | None:
    """Bloco de handoff: diretriz + histórico rotulado por autoria.

    Retorna `None` quando NÃO houve atendimento humano na thread (fluxo normal: zero
    injeção, zero regressão). Quando houve, devolve a diretriz e o transcript recente
    com a autoria de cada mensagem rotulada (`human|ai|contact`).
    """
    if not conversation.get("human_takeover"):
        return None

    lines = [_HANDOFF_DIRECTIVE]
    authored = conversation.get("authored_history") or []
    rendered = [
        f"[{_AUTHOR_LABELS.get(m.get('author_role'), 'Desconhecido')}] {content}"
        for m in authored
        if (content := (m.get("content") or "").strip())
    ]
    if rendered:
        lines.append("Histórico recente, com a autoria de cada mensagem:")
        lines.extend(rendered)
    return "\n".join(lines)


def _peer_line(peer: dict[str, Any]) -> str | None:
    """Uma linha de par: nome + departamento + 1 linha de "quando usar".

    Formato enxuto (custo/tokens): `- Nome (Departamento) [id: <uuid>]: <quando usar>`.
    O `id` é o `targetAgentId` que o LLM deve passar à tool. Sem nome/id → ignora.
    """
    name = (peer.get("name") or "").strip()
    agent_id = (peer.get("id") or "").strip()
    if not name or not agent_id:
        return None
    department = (peer.get("department") or "").strip()
    when = (peer.get("description") or "").strip()
    dept_part = f" ({department})" if department else ""
    when_part = f": {when}" if when else ""
    return f"- {name}{dept_part} [id: {agent_id}]{when_part}"


def _handoff_to_agent_block(agent: dict[str, Any]) -> str | None:
    """Bloco de transferência IA→IA: diretriz + lista de pares (F34-S06).

    Retorna `None` quando o handoff não está habilitado de fato (`allow_handoff` falso
    ou sem pares — o `load_context` já aplica o gate, então `handoff_peers` vazio =
    nada a injetar). Sem regressão no fluxo sem handoff.
    """
    if not agent.get("allow_handoff"):
        return None
    peers = agent.get("handoff_peers") or []
    peer_lines = [line for p in peers if (line := _peer_line(p))]
    if not peer_lines:
        return None

    lines = [_HANDOFF_TO_AGENT_DIRECTIVE, "Agentes disponíveis para transferência:"]
    lines.extend(peer_lines)
    return "\n".join(lines)


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
        handoff = _handoff_block(conversation)
        if handoff:
            parts.append(handoff)

    # Transferência autônoma IA→IA (F34-S06): diretriz + pares disponíveis. Independe de
    # `conversation` (vem do `agent`, populado por load_context). Nada quando OFF.
    handoff_to_agent = _handoff_to_agent_block(agent)
    if handoff_to_agent:
        parts.append(handoff_to_agent)

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
