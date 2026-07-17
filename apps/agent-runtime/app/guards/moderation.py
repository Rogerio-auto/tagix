"""Moderação leve de entrada/saída, plugável e DESLIGADA por padrão (F56-S11 / AG-05).

Filosofia: no-op invisível quando desativada (zero regressão, zero custo), heurística
determinística e sem rede quando ativada. Não substitui a delimitação anti-injection
(`app.guards.injection`) — é uma segunda camada, configurável por workspace.

Resolução de config (precedência):
  1. `state["agent"]["moderation"]` — override por agente/workspace (dict do DB).
  2. variáveis de ambiente `AGENT_MODERATION_*` — default operacional do serviço.
  3. desligada (`ModerationConfig()` com `enabled=False`).

Onde é ligada:
  - entrada: `build_prompt` modera o `user_input` (este slot).
  - saída: `moderate_output` é fornecida e testada para o node `finalize` a plugar
    (F56-S01 detém `finalize.py`; a costura fica pronta e coberta por teste aqui).
"""

from __future__ import annotations

import os
from typing import Any, Final

from pydantic import BaseModel, ConfigDict, Field

from app.guards.injection import detect_injection

_ENV_ENABLED: Final = "AGENT_MODERATION_ENABLED"
_ENV_MAX_INPUT: Final = "AGENT_MODERATION_MAX_INPUT_CHARS"
_ENV_BLOCKED_TERMS: Final = "AGENT_MODERATION_BLOCKED_TERMS"

_TRUTHY: Final = frozenset({"1", "true", "yes", "on"})


class ModerationConfig(BaseModel):
    """Config de moderação resolvida por execução. `enabled=False` ⇒ tudo é no-op."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    enabled: bool = False
    # Teto de tamanho da entrada do usuário (anti prompt-flooding). 0 = sem teto.
    max_input_chars: int = 16000
    # Quando ligada, tratar injeção detectada na ENTRADA como conteúdo a bloquear.
    block_injection: bool = True
    # Denylist extra por workspace (substrings, case-insensitive). Vazio = sem denylist.
    blocked_terms: tuple[str, ...] = Field(default_factory=tuple)


class ModerationResult(BaseModel):
    """Resultado de uma checagem de moderação.

    `allowed=True` é o caminho feliz (segue normal). Quando `False`, `category` e
    `reason` explicam a razão (para log/diretriz de recusa), sem vazar o conteúdo.
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    allowed: bool = True
    category: str | None = None
    reason: str | None = None

    @classmethod
    def ok(cls) -> ModerationResult:
        return cls(allowed=True)

    @classmethod
    def blocked(cls, *, category: str, reason: str) -> ModerationResult:
        return cls(allowed=False, category=category, reason=reason)


def _normalize_terms(raw: Any) -> tuple[str, ...]:
    if isinstance(raw, str):
        parts = raw.split(",")
    elif isinstance(raw, (list, tuple)):
        parts = [str(p) for p in raw]
    else:
        return ()
    return tuple(t.strip().lower() for t in parts if t and t.strip())


def _config_from_env() -> ModerationConfig:
    enabled = os.environ.get(_ENV_ENABLED, "").strip().lower() in _TRUTHY
    max_input_raw = os.environ.get(_ENV_MAX_INPUT, "").strip()
    try:
        max_input = int(max_input_raw) if max_input_raw else 16000
    except ValueError:
        max_input = 16000
    terms = _normalize_terms(os.environ.get(_ENV_BLOCKED_TERMS))
    return ModerationConfig(enabled=enabled, max_input_chars=max_input, blocked_terms=terms)


def resolve_moderation_config(state: dict[str, Any] | None) -> ModerationConfig:
    """Resolve a config de moderação de um `AgentState` (agente → env → desligada).

    Nunca levanta: config malformada degrada para desligada (fail-safe: uma config
    quebrada NÃO deve derrubar a execução do agente).
    """
    agent = (state or {}).get("agent") or {}
    override = agent.get("moderation")
    if isinstance(override, dict):
        try:
            data = dict(override)
            if "blocked_terms" in data:
                data["blocked_terms"] = _normalize_terms(data["blocked_terms"])
            return ModerationConfig.model_validate(data)
        except Exception:  # noqa: BLE001 - config inválida nunca derruba a execução
            return ModerationConfig(enabled=False)
    return _config_from_env()


def _blocked_term_hit(text: str, terms: tuple[str, ...]) -> str | None:
    low = text.lower()
    return next((t for t in terms if t in low), None)


def moderate_input(text: str | None, config: ModerationConfig) -> ModerationResult:
    """Modera a ENTRADA do usuário. No-op (allow) quando `config.enabled` é falso."""
    if not config.enabled or not text:
        return ModerationResult.ok()
    if config.max_input_chars and len(text) > config.max_input_chars:
        return ModerationResult.blocked(
            category="length",
            reason=f"entrada excede {config.max_input_chars} caracteres",
        )
    if config.blocked_terms and (hit := _blocked_term_hit(text, config.blocked_terms)):
        return ModerationResult.blocked(category="blocked_term", reason=f"termo vetado: {hit}")
    if config.block_injection and detect_injection(text):
        return ModerationResult.blocked(
            category="prompt_injection",
            reason="tentativa de sobrescrever instruções detectada na entrada",
        )
    return ModerationResult.ok()


def moderate_output(text: str | None, config: ModerationConfig) -> ModerationResult:
    """Modera a SAÍDA do agente. No-op (allow) quando `config.enabled` é falso.

    Costura pronta para `finalize` (F56-S01) plugar. Não checa injeção na saída
    (a IA não injeta a si mesma); foca em denylist do workspace.
    """
    if not config.enabled or not text:
        return ModerationResult.ok()
    if config.blocked_terms and (hit := _blocked_term_hit(text, config.blocked_terms)):
        return ModerationResult.blocked(category="blocked_term", reason=f"termo vetado: {hit}")
    return ModerationResult.ok()
