"""Classe base das tools do agent-runtime + contexto de execução.

> **Slot:** F2-S06 — `docs/AGENTS_LANGGRAPH.md` §6.1, §6.2, §6.4, §6.5.

Uma `Tool` é a unidade de capacidade que a LLM pode invocar via tool calling.
Esta camada define o **contrato único** que F2-S07 (tools de negócio via callback
Node) e F2-S20 (tools de workflow / `register_conversion`) subclassificam.

Cada tool declara:

  - `key` — identificador estável (vira `function.name` no schema OpenAI).
  - `name` / `description` — metadados para o modelo.
  - `category` — `database` | `knowledge` | `calendar` | `workflow` | `http`.
    O Node já filtra tools por `allowed_tool_categories`; a categoria viaja junto
    para diagnóstico e para o `build_prompt`.
  - `Args` — um `pydantic.BaseModel` aninhado. Dele sai o JSON Schema de
    `parameters` (`§6.4`) e é contra ele que `dispatch` valida os argumentos
    crus vindos do modelo.
  - `table` — tabela-alvo da ACL de coluna (só tools de DB; `None` nas demais).
  - `handler_config` — espelho de `tools.handler_config` (DATA_MODEL §7.5): a
    config de ACL de coluna (`allowed_columns`/`restricted_columns`/...).
    Resolvida do DB pelo Node em produção; aqui carregamos defaults seed e o
    runtime sobrepõe o config efetivo via `with_config(...)`.

A barreira de segurança vive no `_run`/`execute` das subclasses de DB: a
`ColumnPolicy` é resolvida da `handler_config` e aplicada via `safe_columns`
(monta o SELECT) + `project` (filtra a row de volta) — nunca se confia que o
SQL retornou só o permitido.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ValidationError

from app.logging import get_logger
from app.tools.access_control import (
    ColumnAccessError,
    ColumnPolicy,
    policy_from_config,
)

logger = get_logger()

ToolCategory = Literal["database", "knowledge", "calendar", "workflow", "http"]


class ToolContext(BaseModel):
    """Contexto de execução injetado em cada `dispatch`.

    Espelha o `ctx` do contrato com F2-S05 (graph). Campos de identidade vêm do
    `AgentState`; `is_playground` permite às tools simularem efeitos colaterais
    (DB write / callback Node) sem executá-los (vide §15).

    Não carrega o pool nem o http client: esses são injetados na construção da
    tool (DI), não passam pelo wire do modelo — nunca serializa para fora.
    """

    model_config = {"frozen": True}

    workspace_id: str
    conversation_id: str | None = None
    contact_id: str | None = None
    agent_id: str
    execution_id: str
    is_playground: bool = False


class ToolResult(BaseModel):
    """Resultado normalizado de uma execução de tool.

    `dispatch` converte isto no dict do contrato (`{ok, content, error}`). `content`
    é sempre uma string (o que volta como `tool` message para o modelo); `payload`
    é o dado estruturado opcional (já projetado pela ACL — seguro para serializar).
    """

    model_config = {"frozen": True}

    ok: bool
    content: str = ""
    error: str | None = None
    payload: Any = None


class Tool(ABC):
    """Contrato base de toda tool. F2-S07/F2-S20 subclassificam isto.

    Subclasse mínima:

        class MyTool(Tool):
            key = "my_tool"
            name = "Minha tool"
            description = "..."
            category = "database"
            Args = MyArgs                # pydantic.BaseModel
            table = "contacts"           # só DB; None nas demais
            default_handler_config = {...}

            async def _run(self, args: MyArgs, ctx: ToolContext) -> ToolResult:
                ...

    `_run` recebe os args **já validados** contra `Args` e o `ToolContext`. Deve
    devolver um `ToolResult`. Exceções de `_run` são capturadas pelo `registry`
    (nunca vazam de `dispatch`). Tools de DB aplicam a ACL de coluna dentro de
    `_run` usando `self.policy()`.
    """

    # --- declaração (override nas subclasses) ---
    key: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str]
    category: ClassVar[ToolCategory]
    Args: ClassVar[type[BaseModel]]
    table: ClassVar[str | None] = None
    default_handler_config: ClassVar[dict[str, Any]] = {}

    def __init__(self, handler_config: dict[str, Any] | None = None) -> None:
        # validação de declaração: falha cedo se a subclasse está incompleta.
        for attr in ("key", "name", "description", "category", "Args"):
            if not getattr(type(self), attr, None):
                raise TypeError(
                    f"{type(self).__name__} não declarou `{attr}` (contrato Tool)"
                )
        if not (isinstance(self.Args, type) and issubclass(self.Args, BaseModel)):
            raise TypeError(f"{type(self).__name__}.Args deve ser um pydantic.BaseModel")
        # config efetivo = default da tool sobreposto pelo que o runtime resolveu do DB.
        self._handler_config: dict[str, Any] = {
            **type(self).default_handler_config,
            **(handler_config or {}),
        }

    # ------------------------------------------------------------------
    # Config / policy
    # ------------------------------------------------------------------
    @property
    def handler_config(self) -> dict[str, Any]:
        """Config efetivo (default da tool deep-overlaid pelo config resolvido)."""
        return self._handler_config

    def with_config(self, handler_config: dict[str, Any]) -> Tool:
        """Devolve uma nova instância com o `handler_config` resolvido do DB.

        Usado pelo runtime/registry para injetar o config efetivo por workspace
        (vindo de `tools.handler_config` + `agent_tools.overrides`) sem mutar a
        instância registrada por default.
        """
        clone = type(self).__new__(type(self))
        clone.__dict__.update(self.__dict__)
        clone._handler_config = {**type(self).default_handler_config, **handler_config}
        return clone

    def policy(self, *, table: str | None = None) -> ColumnPolicy:
        """Resolve a `ColumnPolicy` a partir da `handler_config` efetiva.

        Barreira de exfiltração das tools de DB. `table` default = `self.table`.
        Levanta `ColumnAccessError` se não houver tabela resolvível.
        """
        return policy_from_config(self._handler_config, table=table or self.table)

    # ------------------------------------------------------------------
    # Schema OpenAI (§6.4)
    # ------------------------------------------------------------------
    def openai_schema(self) -> dict[str, Any]:
        """Spec de tool calling no formato OpenAI/OpenRouter (§6.4)."""
        return {
            "type": "function",
            "function": {
                "name": self.key,
                "description": self.description,
                "parameters": self.Args.model_json_schema(),
            },
        }

    # ------------------------------------------------------------------
    # Execução
    # ------------------------------------------------------------------
    def parse_args(self, raw: dict[str, Any]) -> BaseModel:
        """Valida `raw` (vindo do modelo) contra `Args`. Levanta `ValidationError`."""
        return self.Args.model_validate(raw or {})

    async def execute(self, raw_args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        """Valida args + executa `_run`, normalizando erros para `ToolResult`.

        Nunca levanta: validação inválida, violação de ACL de coluna e exceções
        de runtime viram `ToolResult(ok=False, error=<msg segura, sem PII>)`. O
        `registry.dispatch` apenas serializa o resultado.
        """
        try:
            args = self.parse_args(raw_args)
        except ValidationError as exc:
            logger.warning(
                "tool {key}: args inválidos ({n} erro(s))",
                key=self.key,
                n=len(exc.errors()),
            )
            return ToolResult(
                ok=False,
                error=f"Argumentos inválidos para '{self.key}': {_summarize_validation(exc)}",
            )

        try:
            return await self._run(args, ctx)  # type: ignore[arg-type]
        except ColumnAccessError as exc:
            logger.warning(
                "tool {key}: acesso de coluna negado em {table}",
                key=self.key,
                table=exc.table,
            )
            return ToolResult(
                ok=False,
                error=f"Acesso negado: '{self.key}' não pode acessar campos solicitados.",
            )
        except PermissionError:
            logger.warning("tool {key}: permissão negada", key=self.key)
            return ToolResult(ok=False, error=f"Permissão negada para '{self.key}'.")
        except Exception:  # noqa: BLE001 — fronteira: nada vaza de execute
            logger.exception("tool {key}: falha de execução", key=self.key)
            return ToolResult(
                ok=False,
                error=f"Falha ao executar '{self.key}'.",
            )

    @abstractmethod
    async def _run(self, args: Any, ctx: ToolContext) -> ToolResult:
        """Lógica da tool. Recebe args já validados. Implementado pela subclasse."""
        raise NotImplementedError


def _summarize_validation(exc: ValidationError) -> str:
    """Resumo curto e sem PII dos erros de validação (só caminhos + tipos)."""
    parts: list[str] = []
    for err in exc.errors()[:5]:
        loc = ".".join(str(p) for p in err.get("loc", ())) or "<root>"
        parts.append(f"{loc} ({err.get('type', 'invalid')})")
    return "; ".join(parts)
