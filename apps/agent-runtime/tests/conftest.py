"""Fixtures de teste do agent-runtime.

Seta env obrigatório ANTES de qualquer import de `app.*` (settings são fail-fast)
e limpa o cache do singleton de settings entre execuções.
"""

from __future__ import annotations

import os

# Env obrigatório para as settings carregarem (sem DB real necessário aqui).
os.environ.setdefault("DATABASE_URL", "postgresql://hm:hm@localhost:5432/hm_test")
os.environ.setdefault("OPENROUTER_API_KEY", "sk-or-test-key-not-real")
os.environ.setdefault("OPENAI_API_KEY", "sk-proj-test-key-not-real")
os.environ.setdefault("AGENT_RUNTIME_TOKEN", "test-internal-token")
os.environ.setdefault("LOG_JSON", "false")
