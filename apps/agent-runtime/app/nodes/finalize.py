"""Node `finalize`: resolve a resposta final e persiste execução + uso de LLM.

> **Slot:** F2-S05 — `docs/AGENTS_LANGGRAPH.md` §4.1, §11; `docs/DATA_MODEL.md` §7.7, §7.9.

Último node do grafo. Resolve `final_reply` (conteúdo da última assistant message,
ou string vazia em handoff/bloqueio) e grava, numa única transação sob workspace
RLS (`with_workspace`):

  - `agent_executions` — UPSERT por `id = execution_id`: status final
    (`completed` | `failed`), `state` (snapshot serializado), totais de token/custo,
    `completed_at`. Persistir aqui dá auditoria mesmo se o checkpoint LangGraph for
    podado.
  - `llm_usage_logs` — uma linha agregada da execução (request_type='chat',
    router='openrouter') com `openrouter_generation_id`, tokens e custo. O job de
    reconciliação (F2-S13) corrige `cost_usd` depois via `/generation`.

Persistência é *best-effort*: uma falha de gravação loga e degrada, mas nunca
impede o `/run` de emitir o `final` (a resposta ao usuário não depende do log).
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg
from langgraph.types import StreamWriter

from app.db import with_workspace
from app.logging import get_logger
from app.sandbox import is_sandbox
from app.types import AgentState, ChatMessage, UsageAccumulator

logger = get_logger()


def _hit_iteration_cap(state: AgentState) -> bool:
    """True se paramos com tool_calls pendentes por causa do `max_iterations`.

    Sinal inequívoco no fim do grafo: a última assistant message pediu tools mas
    o loop foi forçado a finalizar (não há node de tool depois). Isso só acontece
    quando `iteration >= policy.max_iterations` (ver `should_continue_loop`).
    """
    if state.get("model_blocked_reason") or state.get("budget_exceeded"):
        return False
    for msg in reversed(state.get("messages", [])):
        if msg.role == "assistant":
            return bool(msg.tool_calls)
        if msg.role == "tool":
            # Há resultados de tool depois da última assistant → não é cap.
            return False
    return False


def _resolve_reply(state: AgentState) -> str:
    explicit = state.get("final_reply")
    if explicit is not None:
        # call_model setou "" em bloqueio/handoff — respeita.
        if explicit != "":
            return explicit
    for msg in reversed(state.get("messages", [])):
        if msg.role == "assistant" and msg.content:
            return msg.content
    return explicit or ""


def _serialize_state(state: AgentState) -> dict[str, Any]:
    """Snapshot JSON-safe do state para `agent_executions.state`."""

    def _msg(m: ChatMessage) -> dict[str, Any]:
        return m.model_dump(exclude_none=True)

    usage = state.get("usage") or UsageAccumulator()
    policy = state.get("policy")
    return {
        "workspace_id": state.get("workspace_id"),
        "agent_id": state.get("agent_id"),
        "conversation_id": state.get("conversation_id"),
        "contact_id": state.get("contact_id"),
        "thread_id": state.get("thread_id"),
        "iteration": state.get("iteration", 0),
        "messages": [_msg(m) for m in state.get("messages", [])],
        "tool_calls_executed": state.get("tool_calls_executed", []),
        "usage": usage.model_dump(),
        "policy": policy.model_dump() if policy is not None else None,
        "errors": state.get("errors", []),
        "should_handoff": state.get("should_handoff", False),
        "model_blocked_reason": state.get("model_blocked_reason"),
        "budget_exceeded": state.get("budget_exceeded", False),
    }


async def _persist(pool: asyncpg.Pool, state: AgentState, *, reply: str) -> None:
    usage = state.get("usage") or UsageAccumulator()
    errors = state.get("errors", [])
    blocked = state.get("model_blocked_reason")
    failed = bool(errors) or bool(blocked) or bool(state.get("budget_exceeded"))
    status = "failed" if failed else "completed"
    error_text = "; ".join(errors) if errors else (blocked or None)
    state_json = json.dumps(_serialize_state(state), default=str)

    workspace_id = state["workspace_id"]
    execution_id = state.get("execution_id") or state.get("thread_id")
    sandbox = is_sandbox(state)

    async with pool.acquire() as conn:
        async with with_workspace(conn, workspace_id) as scoped:
            # SANDBOX (F26-S06): nao grava a execucao de producao em agent_executions.
            # O playground e efemero -- a inspecao do trace vem do stream SSE, nao do DB.
            if not sandbox:
                await scoped.execute(
                    """
                    INSERT INTO agent_executions
                        (id, workspace_id, agent_id, conversation_id, thread_id,
                         status, current_node, state, total_tokens, total_cost_usd,
                         updated_at, completed_at, error)
                    VALUES
                        ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
                         $6, $7, $8::jsonb, $9, $10,
                         now(), now(), $11)
                    ON CONFLICT (id) DO UPDATE SET
                        status         = EXCLUDED.status,
                        current_node   = EXCLUDED.current_node,
                        state          = EXCLUDED.state,
                        total_tokens   = EXCLUDED.total_tokens,
                        total_cost_usd = EXCLUDED.total_cost_usd,
                        updated_at     = now(),
                        completed_at   = EXCLUDED.completed_at,
                        error          = EXCLUDED.error
                    """,
                    execution_id,
                    workspace_id,
                    state["agent_id"],
                    state.get("conversation_id"),
                    state.get("thread_id", str(execution_id)),
                    status,
                    "finalize",
                    state_json,
                    usage.total_tokens,
                    usage.total_cost_usd,
                    error_text,
                )

            # Só registra uso de LLM se houve de fato uma chamada (tokens > 0 ou
            # generation_id presente) — evita linha vazia em bloqueios pré-chamada.
            if usage.total_tokens > 0 or state.get("generation_id"):
                metadata: dict[str, Any] = {"reply_chars": len(reply)}
                if sandbox:
                    metadata["playground"] = True
                    # "would-do": as tools de side-effect foram mockadas (nao executadas).
                    would_do = [
                        tc for tc in state.get("tool_calls_executed", []) if tc
                    ]
                    if would_do:
                        metadata["would_do_tool_calls"] = would_do
                # SANDBOX: o custo do teste vai para is_test=true -> fora do cap/billing
                # de producao (coluna da F26-S01). Em live, is_test=false.
                await scoped.execute(
                    """
                    INSERT INTO llm_usage_logs
                        (workspace_id, agent_id, conversation_id, execution_id,
                         request_type, router, openrouter_generation_id, model,
                         prompt_tokens, completion_tokens, reasoning_tokens,
                         total_tokens, cost_usd, finish_reason, is_test, metadata)
                    VALUES
                        ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                         'chat', 'openrouter', $5, $6,
                         $7, $8, $9,
                         $10, $11, $12, $13, $14::jsonb)
                    """,
                    workspace_id,
                    state["agent_id"],
                    # Em sandbox a conversa e efemera -> nao correlaciona com conversa real.
                    None if sandbox else state.get("conversation_id"),
                    execution_id,
                    state.get("generation_id"),
                    (state.get("agent") or {}).get("model", ""),
                    usage.prompt_tokens,
                    usage.completion_tokens,
                    usage.reasoning_tokens,
                    usage.total_tokens,
                    usage.total_cost_usd,
                    "stop" if status == "completed" else status,
                    sandbox,
                    json.dumps(metadata),
                )


def make_finalize_node(pool: asyncpg.Pool):
    """Fábrica do node `finalize`, ligada a um pool asyncpg."""

    async def finalize_node(state: AgentState, writer: StreamWriter) -> dict[str, Any]:
        reply = _resolve_reply(state)
        if _hit_iteration_cap(state):
            writer({"type": "iteration_exceeded"})
        try:
            await _persist(pool, state, reply=reply)
        except Exception as exc:  # noqa: BLE001 - log de execução é best-effort
            logger.error(
                "finalize: falha ao persistir execução/uso",
                error=type(exc).__name__,
                workspace_id=state.get("workspace_id"),
            )
        logger.debug("finalize ok", reply_chars=len(reply))
        return {"final_reply": reply, "generation_id": state.get("generation_id")}

    return finalize_node
