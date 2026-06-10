"""PII redaction é fundação de segurança: telefone/email/token nunca em claro."""

from __future__ import annotations

from app.logging import redact_pii


def test_redacts_email() -> None:
    out = redact_pii("contato: rogerio5566.ro@gmail.com agora")
    assert "rogerio5566.ro@gmail.com" not in out
    assert "[REDACTED]" in out


def test_redacts_phone() -> None:
    out = redact_pii("ligar para +55 11 98765-4321 hoje")
    assert "98765" not in out
    assert "[REDACTED]" in out


def test_redacts_bearer_token() -> None:
    out = redact_pii("Authorization: Bearer abc123.def456-ghi")
    assert "abc123.def456-ghi" not in out
    assert "[REDACTED]" in out


def test_redacts_provider_key() -> None:
    out = redact_pii("key=sk-or-v1-0a1b2c3d4e5f6a7b8c9d")
    assert "0a1b2c3d4e5f6a7b8c9d" not in out
    assert "[REDACTED]" in out


def test_redacts_secret_kv() -> None:
    out = redact_pii('{"api_key": "supersecretvalue123"}')
    assert "supersecretvalue123" not in out
    assert "[REDACTED]" in out


def test_keeps_plain_text() -> None:
    text = "execucao do agente concluida com 3 iteracoes"
    assert redact_pii(text) == text


def test_idempotent() -> None:
    once = redact_pii("email user@example.com fim")
    assert redact_pii(once) == once
