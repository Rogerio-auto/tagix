"""Configuração do agent-runtime carregada do ambiente (fail-fast)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    port: int
    database_url: str
    openrouter_api_key: str
    agent_runtime_token: str

    @staticmethod
    def load() -> "Settings":
        def required(name: str) -> str:
            value = os.environ.get(name)
            if not value:
                raise RuntimeError(f"Variável de ambiente obrigatória ausente: {name}")
            return value

        return Settings(
            port=int(os.environ.get("AGENT_RUNTIME_PORT", "8001")),
            database_url=required("DATABASE_URL"),
            openrouter_api_key=required("OPENROUTER_API_KEY"),
            agent_runtime_token=required("AGENT_RUNTIME_TOKEN"),
        )
