"""Agent Playground sandbox (F26-S06, PLATFORM_TENANT_MANAGEMENT secao 7; PRD secao 80).

Modo `sandbox` do `/run`: roda o grafo de um agente em TESTE com **zero side-effect
de producao**. A invariante critica desta fase:

  1. Tools de negocio com side-effect (callback ao Node: send_message / register_conversion
     / trigger_flow) NAO executam -- viram mock que so registra "teria feito X" (a
     fronteira ja existe via `ToolContext.is_playground`, herdada da F2; sandbox a liga).
  2. NADA e persistido em `conversations` / `messages` (o runtime nunca escreve essas
     tabelas; quem escreve e a API Node, que NAO e chamada em sandbox).
  3. `agent_executions` NAO recebe a linha de producao em sandbox (e dado de producao).
  4. O custo LLM real do teste vai para `llm_usage_logs` com `is_test = true` -- separado
     do billing/cap de producao (a coluna vem da F26-S01).
  5. A policy enforcement (allowed_models / caps / whitelist) continua valendo IGUAL ao
     live -- sandbox nao e bypass de seguranca, so de side-effect/persistencia.

Este modulo concentra os predicados que `run.py` e o node `finalize` consultam, para que
a regra de "o que e sandbox" viva num lugar so.
"""

from __future__ import annotations

from typing import Final

from app.types import AgentState

#: Valor de `mode` no payload do /run que liga o sandbox. Default do endpoint = "live".
SANDBOX_MODE: Final = "sandbox"
LIVE_MODE: Final = "live"


def is_sandbox(state: AgentState) -> bool:
    """True se a execucao corrente roda em modo sandbox (playground).

    O sandbox reusa a flag `is_playground` do AgentState (carregada pela F2 e ja
    respeitada pelas tools de callback) -- mantendo um unico interruptor de
    side-effect. `mode='sandbox'` no /run liga `is_playground=True`.
    """
    return bool(state.get("is_playground", False))
