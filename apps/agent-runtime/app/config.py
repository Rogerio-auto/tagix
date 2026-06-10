"""Configuração do agent-runtime carregada do ambiente (fail-fast, via pydantic-settings).

Os campos obrigatórios (`database_url`, `openrouter_api_key`, `agent_runtime_token`)
não têm default: se faltarem no ambiente, a instância falha no boot — nunca em runtime.

Downstream slots:
- F2-S04 (OpenRouter) lê `settings.openrouter_api_key`.
- Tools de negócio (F2-S06/S07) leem `settings.api_base_url` + `settings.agent_runtime_token`
  para o callback HTTP ao Node.
- F2-S05 (graph/checkpointer) lê `settings.database_url` (conexão psycopg própria).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings tipadas do agent-runtime. Toda config externa entra por aqui."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    # rede
    host: str = Field(default="0.0.0.0", alias="AGENT_RUNTIME_HOST")
    port: int = Field(default=8001, alias="AGENT_RUNTIME_PORT")

    # banco (RLS multi-tenant; pool asyncpg em app/db.py)
    database_url: PostgresDsn = Field(alias="DATABASE_URL")
    db_pool_min_size: int = Field(default=1, alias="DB_POOL_MIN_SIZE")
    db_pool_max_size: int = Field(default=10, alias="DB_POOL_MAX_SIZE")

    # LLM router (consumido em F2-S04)
    openrouter_api_key: str = Field(alias="OPENROUTER_API_KEY")

    # Embeddings — OpenAI DIRETO (text-embedding-3-small, 1536 dims; F3-S02).
    # OpenRouter NÃO roteia embeddings; dimensão é contrato rígido com vector(1536).
    openai_api_key: str = Field(alias="OPENAI_API_KEY")
    embedding_model: str = Field(default="text-embedding-3-small", alias="EMBEDDING_MODEL")
    embedding_dim: int = Field(default=1536, alias="EMBEDDING_DIM")

    # callback interno Node <-> runtime (consumido pelas tools de negócio em F2-S06/S07)
    agent_runtime_token: str = Field(alias="AGENT_RUNTIME_TOKEN")
    api_base_url: str = Field(default="http://api:3001", alias="API_BASE_URL")

    # CORS interno (origens permitidas a chamar o runtime; default: só rede interna)
    cors_allow_origins: tuple[str, ...] = Field(
        default=("http://api:3001",), alias="CORS_ALLOW_ORIGINS"
    )

    # logging
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    log_json: bool = Field(default=True, alias="LOG_JSON")

    @property
    def asyncpg_dsn(self) -> str:
        """DSN no formato que o asyncpg aceita (sem o esquema SQLAlchemy `+driver`)."""
        return str(self.database_url)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton das settings (carregado uma vez por processo)."""
    return Settings()  # type: ignore[call-arg]  # valores vêm do ambiente
