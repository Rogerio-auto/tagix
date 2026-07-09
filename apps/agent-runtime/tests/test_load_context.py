"""Testes do node `load_context` — guarda de schema de `_load_agent` (F56-S01).

O bug AG-01 passou porque os fakes de teste devolviam qualquer coluna que o SQL
pedisse: o SELECT referenciava `model_supports_vision`, que NÃO existe na tabela
`agents` real (a capacidade de visão deriva de `vision_model text`), e o asyncpg
levantava `UndefinedColumnError` no primeiro node do grafo em produção.

Aqui o fake espelha o schema REAL (`packages/db/src/schema/agents.ts`): qualquer
coluna referenciada no SELECT fora do contrato levanta `FakeUndefinedColumnError`
— exatamente o comportamento do Postgres. Se o schema de `agents` mudar,
atualize `REAL_AGENTS_COLUMNS` junto.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from app.nodes.load_context import _load_agent

# ---------------------------------------------------------------------------
# Espelho 1:1 das colunas reais de `agents` (packages/db/src/schema/agents.ts)
# ---------------------------------------------------------------------------

REAL_AGENTS_COLUMNS: frozenset[str] = frozenset(
    {
        "id",
        "workspace_id",
        "template_id",
        "name",
        "description",
        "system_prompt",
        "model",
        "model_params",
        "vision_model",
        "transcription_model",
        "status",
        "aggregation_enabled",
        "aggregation_window_sec",
        "max_batch_messages",
        "reply_if_idle_sec",
        "allow_handoff",
        "ignore_group_messages",
        "enabled_channel_ids",
        "api_token_hash",
        "created_at",
        "updated_at",
    }
)

_AGENT_ID = "11111111-1111-1111-1111-111111111111"


class FakeUndefinedColumnError(Exception):
    """Espelha `asyncpg.exceptions.UndefinedColumnError` (coluna inexistente)."""


# ---------------------------------------------------------------------------
# Mini-avaliador do SELECT (as formas de expressão usadas por _load_agent)
# ---------------------------------------------------------------------------

_COL_REF = re.compile(r"^(\w+)(?:::\w+)?$")
_COALESCE_IS_NOT_NULL = re.compile(
    r"^COALESCE\(\((\w+)\s+IS\s+NOT\s+NULL\),\s*false\)(?:\s+AS\s+(\w+))?$",
    re.IGNORECASE,
)
_COALESCE_FALSE = re.compile(
    r"^COALESCE\((\w+),\s*false\)(?:\s+AS\s+(\w+))?$",
    re.IGNORECASE,
)


def _split_select_items(query: str) -> list[str]:
    """Extrai os itens da SELECT-list (split por vírgula fora de parênteses)."""
    match = re.search(r"\bSELECT\b(.*?)\bFROM\b", query, flags=re.IGNORECASE | re.DOTALL)
    assert match is not None, f"query sem SELECT ... FROM: {query!r}"
    items: list[str] = []
    depth = 0
    current: list[str] = []
    for ch in match.group(1):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            items.append("".join(current))
            current = []
        else:
            current.append(ch)
    items.append("".join(current))
    return [" ".join(item.split()) for item in items if item.strip()]


def _resolve_column(record: dict[str, Any], name: str) -> Any:
    """Resolve uma referência de coluna como o Postgres: inexistente → erro."""
    if name not in REAL_AGENTS_COLUMNS:
        raise FakeUndefinedColumnError(f'column "{name}" of relation "agents" does not exist')
    return record[name]


def _evaluate_item(item: str, record: dict[str, Any]) -> tuple[str, Any]:
    """Avalia um item da SELECT-list contra o record → (alias, valor)."""
    if m := _COL_REF.match(item):
        col = m.group(1)
        return col, _resolve_column(record, col)
    if m := _COALESCE_IS_NOT_NULL.match(item):
        col, alias = m.group(1), m.group(2)
        return alias or col, _resolve_column(record, col) is not None
    if m := _COALESCE_FALSE.match(item):
        col, alias = m.group(1), m.group(2)
        value = _resolve_column(record, col)
        return alias or col, value if value is not None else False
    raise AssertionError(f"expressão de SELECT não suportada pelo fake: {item!r}")


class FakeAgentsConn:
    """Conn fake cuja resolução de colunas espelha o schema real de `agents`."""

    def __init__(self, record: dict[str, Any]) -> None:
        self._record = record

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        assert "FROM agents" in query
        if args and args[0] != self._record["id"]:
            return None
        return dict(_evaluate_item(item, self._record) for item in _split_select_items(query))


def _agents_record(**overrides: Any) -> dict[str, Any]:
    """Uma linha de `agents` com TODAS as colunas reais (defaults do schema)."""
    base: dict[str, Any] = {
        "id": _AGENT_ID,
        "workspace_id": "22222222-2222-2222-2222-222222222222",
        "template_id": None,
        "name": "Vendedor",
        "description": None,
        "system_prompt": "Você é um vendedor.",
        "model": "openai/gpt-4o-mini",
        "model_params": {"temperature": 0.2},
        "vision_model": "gpt-4o",
        "transcription_model": "whisper-1",
        "status": "active",
        "aggregation_enabled": True,
        "aggregation_window_sec": 20,
        "max_batch_messages": 20,
        "reply_if_idle_sec": None,
        "allow_handoff": True,
        "ignore_group_messages": True,
        "enabled_channel_ids": [],
        "api_token_hash": None,
        "created_at": None,
        "updated_at": None,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Testes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_agent_select_references_only_real_columns() -> None:
    """Regressão AG-01: o SELECT roda contra o schema real (sem coluna fantasma)."""
    conn = FakeAgentsConn(_agents_record())

    agent = await _load_agent(conn, _AGENT_ID)  # type: ignore[arg-type]

    assert agent["id"] == _AGENT_ID
    assert agent["model"] == "openai/gpt-4o-mini"
    assert agent["system_prompt"] == "Você é um vendedor."
    assert agent["model_params"] == {"temperature": 0.2}
    assert agent["allow_handoff"] is True
    # vision_model preenchido → o flag derivado é True.
    assert agent["model_supports_vision"] is True


@pytest.mark.asyncio
async def test_load_agent_vision_flag_false_when_vision_model_null() -> None:
    conn = FakeAgentsConn(_agents_record(vision_model=None))

    agent = await _load_agent(conn, _AGENT_ID)  # type: ignore[arg-type]

    assert agent["model_supports_vision"] is False


@pytest.mark.asyncio
async def test_load_agent_normalizes_non_dict_model_params() -> None:
    conn = FakeAgentsConn(_agents_record(model_params=None))

    agent = await _load_agent(conn, _AGENT_ID)  # type: ignore[arg-type]

    assert agent["model_params"] == {}


@pytest.mark.asyncio
async def test_load_agent_raises_lookup_error_when_missing() -> None:
    conn = FakeAgentsConn(_agents_record())

    with pytest.raises(LookupError):
        await _load_agent(conn, "99999999-9999-9999-9999-999999999999")  # type: ignore[arg-type]


def test_fake_schema_guard_catches_ag01_query() -> None:
    """Prova que o guard pega o SQL antigo: `model_supports_vision` não é coluna."""
    with pytest.raises(FakeUndefinedColumnError, match="model_supports_vision"):
        _evaluate_item(
            "COALESCE(model_supports_vision, false) AS model_supports_vision",
            _agents_record(),
        )
