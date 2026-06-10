"""Rotas HTTP do agent-runtime (montadas em `app/main.py` via `include_router`)."""

from __future__ import annotations

from .run import router as run_router

__all__ = ["run_router"]
