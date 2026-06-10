"""Registry de tools + seam de integração com o grafo (F2-S05).

> **Slot:** F2-S06 — `docs/AGENTS_LANGGRAPH.md` §6.1.

O registry guarda as tools por `key`, expõe os specs OpenAI filtrados por policy
(para o `call_model`) e despacha invocações vindas do `tool_dispatch`. É o ponto
único de resolução `key -> Tool`.

Contrato com o grafo (S05), obedecido estruturalmente (duck-typing):

  - `specs_for(allowed_keys) -> list[dict]`  — specs OpenAI, filtrados.
  - `async dispatch(key, args, ctx) -> dict` — `{ok, content, error}`; nunca levanta.

A injeção é via `build_default_registry(pool, http_client=None)`, que registra as
tools "leves" de DB já com seus `handler_config` seed. F2-S07/F2-S20 estendem
registrando novas instâncias de `Tool`.
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg

from app.logging import get_logger
from app.tools.base import Tool, ToolContext, ToolResult

logger = get_logger()

__all__ = ["ToolRegistry", "build_default_registry"]


class ToolRegistry:
    """Coleção mutável de tools, indexada por `key`. Seam para o grafo."""

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    # ------------------------------------------------------------------
    # Registro / resolução
    # ------------------------------------------------------------------
    def register(self, tool: Tool, *, override: bool = False) -> None:
        """Adiciona uma tool. Erro em key duplicada salvo `override=True`."""
        if tool.key in self._tools and not override:
            raise ValueError(f"tool '{tool.key}' já registrada")
        self._tools[tool.key] = tool

    def get(self, key: str) -> Tool | None:
        """Resolve uma tool por key (None se ausente)."""
        return self._tools.get(key)

    def has(self, key: str) -> bool:
        return key in self._tools

    def keys(self) -> set[str]:
        return set(self._tools)

    def __len__(self) -> int:
        return len(self._tools)

    def __contains__(self, key: object) -> bool:
        return key in self._tools

    # ------------------------------------------------------------------
    # Seam do grafo (F2-S05) — contrato fixo
    # ------------------------------------------------------------------
    def specs_for(self, allowed_keys: set[str] | None) -> list[dict]:
        """Specs OpenAI de tool calling, filtrados por `allowed_keys`.

        `None` = todas as tools registradas. Ordem estável (por key) para
        determinismo de prompt/checkpoint. Cada item é o `openai_schema()` da tool.
        """
        out: list[dict] = []
        for key in sorted(self._tools):
            if allowed_keys is not None and key not in allowed_keys:
                continue
            out.append(self._tools[key].openai_schema())
        return out

    async def dispatch(self, key: str, args: dict, ctx: dict) -> dict:
        """Valida + executa a tool `key`. Nunca levanta (contrato com S05).

        Retorna sempre `{"ok": bool, "content": str, "error": str | None}`. Erro
        de tool desconhecida, contexto inválido, validação, ACL ou runtime vira
        `{"ok": False, ...}` com mensagem segura (sem PII).
        """
        tool = self._tools.get(key)
        if tool is None:
            logger.warning("dispatch: tool desconhecida '{key}'", key=str(key))
            return _err(f"Ferramenta desconhecida: '{key}'.")

        try:
            tool_ctx = ToolContext.model_validate(ctx)
        except Exception:  # noqa: BLE001 — contexto torto não derruba o dispatch
            logger.warning("dispatch: contexto inválido para '{key}'", key=key)
            return _err(f"Contexto de execução inválido para '{key}'.")

        result = await tool.execute(args or {}, tool_ctx)
        return _to_contract(result)


def _err(message: str) -> dict[str, Any]:
    return {"ok": False, "content": "", "error": message}


def _to_contract(result: ToolResult) -> dict[str, Any]:
    """Serializa um `ToolResult` no dict do contrato com o grafo.

    Em sucesso, `content` é a string que vira a `tool` message para o modelo: usa
    `result.content` se presente, senão um JSON compacto do `payload` (já projetado
    pela ACL — seguro). Falhas carregam `error` e `content` vazio.
    """
    if not result.ok:
        return {"ok": False, "content": "", "error": result.error or "Falha na ferramenta."}

    content = result.content
    if not content:
        content = _safe_json(result.payload)
    return {"ok": True, "content": content, "error": None}


def _safe_json(payload: Any) -> str:
    """JSON compacto e estável do payload; nunca levanta."""
    if payload is None:
        return ""
    try:
        return json.dumps(payload, ensure_ascii=False, default=str, sort_keys=True)
    except (TypeError, ValueError):
        return str(payload)


def build_default_registry(
    pool: asyncpg.Pool,
    *,
    http_client: Any = None,
) -> ToolRegistry:
    """Fábrica: registry com as tools "leves" de DB de F2-S06.

    `pool` é o asyncpg pool (`app.db.get_pool()`), injetado nas tools de DB para
    rodarem sob `with_workspace`. `http_client` fica no contrato para F2-S07/S20
    (tools de callback Node) — ignorado aqui, pois nenhuma tool leve faz HTTP.

    Retorna um `ToolRegistry` pronto para injeção no grafo (S05).
    """
    # import local evita ciclo (database/* importa de base, que não importa registry)
    from app.tools.database import build_light_db_tools

    registry = ToolRegistry()
    for tool in build_light_db_tools(pool):
        registry.register(tool)
    logger.info("registry default: {n} tool(s) registrada(s)", n=len(registry))
    return registry
