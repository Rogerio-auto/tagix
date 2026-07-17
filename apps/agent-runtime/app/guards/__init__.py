"""Guardrails conversacionais do agente (F56-S11 / AUDITORIA_TECNICA §3.3 — AG-05).

Duas defesas, desacopladas e testáveis em isolamento:

- `injection` — **anti-prompt-injection estrutural**. Separa dados não-confiáveis
  (nome/campos do contato, histórico rotulado) do system prompt de alta autoridade
  via delimitação inviolável ("spotlighting") + diretriz explícita. É a defesa
  primária: robusta por construção, não por blocklist de frases.
- `moderation` — **moderação leve de entrada/saída**, plugável e DESLIGADA por
  padrão (no-op quando desabilitada). Heurística determinística e sem rede.

Nada aqui faz IO nem chama LLM: são funções puras, seguras para compor em qualquer
node do grafo.
"""

from __future__ import annotations

from app.guards.injection import (
    ANTI_INJECTION_DIRECTIVE,
    UNTRUSTED_SENTINEL_CHARS,
    detect_injection,
    neutralize_untrusted,
    wrap_untrusted,
)
from app.guards.moderation import (
    ModerationConfig,
    ModerationResult,
    moderate_input,
    moderate_output,
    resolve_moderation_config,
)

__all__ = [
    "ANTI_INJECTION_DIRECTIVE",
    "UNTRUSTED_SENTINEL_CHARS",
    "detect_injection",
    "neutralize_untrusted",
    "wrap_untrusted",
    "ModerationConfig",
    "ModerationResult",
    "moderate_input",
    "moderate_output",
    "resolve_moderation_config",
]
