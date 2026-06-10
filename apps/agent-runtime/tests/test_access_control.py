"""Testes da column-level access control (F2-S10).

Foco: deny-by-default, precedência de `restricted` sobre `allowed`, baseline
estático de secrets sempre negado, projeção de rows e validação de required.
"""

from __future__ import annotations

import pytest

from app.tools.access_control import (
    ALWAYS_DENIED,
    ColumnAccessError,
    ColumnPolicy,
    allowed_columns,
    ensure_required,
    policy_from_config,
    project,
    safe_columns,
)

# --- handler_config canônico (espelha tools.handler_config / DATA_MODEL §7.5) ---

CONTACTS_CFG = {
    "table": "contacts",
    "allowed_columns": {
        "read": ["display_name", "email", "phone", "tags", "source"],
        "write": ["display_name", "email", "phone"],
    },
    "restricted_columns": ["notes"],
    "required_columns": ["display_name"],
}


# --------------------------------------------------------------------------
# Deny-by-default
# --------------------------------------------------------------------------


def test_unknown_column_denied_by_default() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    assert not policy.is_allowed("custom_fields", "read")
    assert not policy.is_allowed("owner_id", "read")
    assert policy.is_allowed("email", "read")


def test_empty_config_denies_everything() -> None:
    policy = ColumnPolicy(table="contacts")
    assert policy.allowed("read") == frozenset()
    assert policy.allowed("write") == frozenset()


def test_missing_allowed_columns_key_denies_all() -> None:
    cols = allowed_columns({"table": "contacts"}, access="read")
    assert cols == frozenset()


def test_read_and_write_are_separate_allowlists() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    assert policy.is_allowed("source", "read")
    assert not policy.is_allowed("source", "write")  # read-only column


# --------------------------------------------------------------------------
# restricted precedence
# --------------------------------------------------------------------------


def test_restricted_beats_allowed() -> None:
    cfg = {
        "table": "contacts",
        "allowed_columns": {"read": ["display_name", "notes"]},
        "restricted_columns": ["notes"],
    }
    policy = policy_from_config(cfg)
    assert policy.is_allowed("display_name", "read")
    assert not policy.is_allowed("notes", "read")  # restricted wins


# --------------------------------------------------------------------------
# Static baseline of always-denied secrets
# --------------------------------------------------------------------------


def test_always_denied_secret_columns_never_pass() -> None:
    # Even if a malicious/misconfigured policy allows secret columns explicitly.
    cfg = {
        "table": "channel_secrets",
        "allowed_columns": {"read": ["access_token_enc", "api_key_enc"]},
    }
    policy = policy_from_config(cfg)
    assert policy.allowed("read") == frozenset()


def test_always_denied_by_naming_heuristic() -> None:
    cfg = {
        "table": "some_future_table",
        "allowed_columns": {"read": ["name", "password", "session_token", "value_enc"]},
    }
    policy = policy_from_config(cfg)
    assert policy.is_allowed("name", "read")
    assert not policy.is_allowed("password", "read")
    assert not policy.is_allowed("session_token", "read")
    assert not policy.is_allowed("value_enc", "read")


def test_always_denied_table_map_is_populated() -> None:
    # Guards against accidental wipe of the security baseline.
    assert "channel_secrets" in ALWAYS_DENIED
    assert "access_token_enc" in ALWAYS_DENIED["channel_secrets"]
    assert "value_enc" in ALWAYS_DENIED["platform_secrets"]


# --------------------------------------------------------------------------
# safe_columns
# --------------------------------------------------------------------------


def test_safe_columns_filters_and_preserves_order() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    requested = ["email", "notes", "display_name", "custom_fields"]
    assert safe_columns(requested, policy, access="read") == ["email", "display_name"]


def test_safe_columns_dedups() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    assert safe_columns(["email", "email", "phone"], policy) == ["email", "phone"]


def test_safe_columns_empty_when_all_denied() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    assert safe_columns(["notes", "custom_fields"], policy) == []


# --------------------------------------------------------------------------
# project
# --------------------------------------------------------------------------


def test_project_drops_unpermitted_keys() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    row = {
        "display_name": "Maria",
        "email": "m@example.com",
        "notes": "internal secret note",
        "owner_id": "uuid-x",
    }
    out = project(row, policy, access="read")
    assert out == {"display_name": "Maria", "email": "m@example.com"}


def test_project_none_passes_through() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    assert project(None, policy) is None


def test_project_secret_table_returns_empty_dict() -> None:
    policy = policy_from_config({"table": "channel_secrets", "allowed_columns": {"read": []}})
    row = {"access_token_enc": "ya29.secret", "key_version": 3}
    assert project(row, policy, access="read") == {}


# --------------------------------------------------------------------------
# ensure_required
# --------------------------------------------------------------------------


def test_ensure_required_passes_when_present() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    # display_name is required AND writable.
    ensure_required(["display_name", "email"], policy, access="write")


def test_ensure_required_raises_when_missing() -> None:
    policy = policy_from_config(CONTACTS_CFG)
    with pytest.raises(ColumnAccessError) as exc:
        ensure_required(["email"], policy, access="write")
    assert exc.value.table == "contacts"
    assert "display_name" in exc.value.columns


def test_ensure_required_raises_when_required_not_writable() -> None:
    cfg = {
        "table": "contacts",
        "allowed_columns": {"write": ["email"]},
        "required_columns": ["display_name"],  # required but not in write allowlist
    }
    policy = policy_from_config(cfg)
    with pytest.raises(ColumnAccessError):
        ensure_required(["display_name"], policy, access="write")


# --------------------------------------------------------------------------
# Defensive coercion of malformed JSONB config
# --------------------------------------------------------------------------


def test_no_table_raises() -> None:
    with pytest.raises(ColumnAccessError):
        policy_from_config({"allowed_columns": {"read": ["x"]}})


def test_table_override_wins() -> None:
    policy = policy_from_config({"allowed_columns": {"read": ["x"]}}, table="contacts")
    assert policy.table == "contacts"
    assert policy.is_allowed("x", "read")


def test_malformed_allowed_columns_string_is_denied() -> None:
    # A bare string where a list is expected must NOT be treated as columns.
    cfg = {"table": "contacts", "allowed_columns": {"read": "email"}}
    policy = policy_from_config(cfg)
    assert policy.allowed("read") == frozenset()


def test_non_string_items_dropped() -> None:
    cfg = {"table": "contacts", "allowed_columns": {"read": ["email", 123, None, "phone"]}}
    policy = policy_from_config(cfg)
    assert policy.allowed("read") == frozenset({"email", "phone"})


def test_none_config_denies_with_table_override() -> None:
    policy = policy_from_config(None, table="contacts")
    assert policy.allowed("read") == frozenset()
