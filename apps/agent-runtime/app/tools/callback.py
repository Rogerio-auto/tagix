"""Base das tools "de negócio" — transporte callback HTTP Python → Node.

> **Slot:** F2-S07 — `docs/AGENTS_LANGGRAPH.md` §6.3, §7.4.

Algumas tools não executam no runtime: a regra de negócio (transferir conversa,
registrar conversão, disparar flow…) é *single source of truth* no Node. Para
essas, o runtime chama de volta o Node por HTTP — `POST {api_base_url}/internal/
tools/{key}` — autenticando com o **token interno compartilhado**
(`AGENT_RUNTIME_TOKEN`). O Node valida o token, faz dispatch por `toolKey`, roda
a ação sob RLS e grava `tool_logs`.

`CallbackTool` é a base desse transporte. As tools concretas (F2-S20:
`transfer_to_human`, `register_conversion`, …) subclassam declarando só os
metadados + `Args`:

    class TransferToHumanArgs(BaseModel):
        reason: str
        department_id: str | None = None

    class TransferToHumanTool(CallbackTool):
        key = "transfer_to_human"
        name = "Transferir para humano"
        description = "Tira o agente da conversa e a entrega a um atendente."
        category = "workflow"
        Args = TransferToHumanArgs

Nenhuma subclasse precisa reimplementar `_run`: o transporte (serialização do
envelope, header de auth, tratamento de timeout/erro HTTP, normalização para
`ToolResult`) vive inteiro aqui. O `is_playground` curto-circuita o callback —
nenhum efeito colateral no Node em simulação.

Segurança: o token interno NUNCA aparece em `ToolResult.error` nem em log claro
(o sink de logging já redige `Bearer …`, mas aqui também não o construímos em
mensagens de erro). Corpo de resposta de erro do Node não é repassado cru ao
modelo — só uma mensagem segura e estável.
"""

from __future__ import annotations

from typing import Any, ClassVar

import httpx
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.logging import get_logger
from app.tools.base import Tool, ToolContext, ToolResult

logger = get_logger()

# Timeout do callback ao Node. Curto: ações de negócio são síncronas e baratas;
# se o Node demora além disso, devolvemos erro de timeout em vez de travar o turn.
_DEFAULT_TIMEOUT = 15.0


class CallbackTool(Tool):
    """Tool cujo efeito é delegado ao Node via callback HTTP interno.

    Subclasses declaram `key`/`name`/`description`/`category`/`Args` (contrato
    `Tool`) e NADA mais — `_run` é final aqui. O `http` client e as `settings`
    são injetados na construção (DI): nunca serializam para o wire do modelo.

    Construção (feita pelo registry em F2-S20):

        tool = TransferToHumanTool(client=http_client)

    Se `client` não for passado, um `httpx.AsyncClient` próprio é criado e fechado
    em `aclose()` — útil para testes; em produção reusa-se um client por processo.
    """

    # Tools de negócio não têm tabela-alvo de ACL de coluna; o Node aplica RLS.
    table: ClassVar[str | None] = None

    def __init__(
        self,
        *,
        client: httpx.AsyncClient | None = None,
        settings: Settings | None = None,
        handler_config: dict[str, Any] | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        super().__init__(handler_config)
        self._settings = settings or get_settings()
        self._timeout = timeout
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout)

    # ------------------------------------------------------------------ lifecycle
    async def aclose(self) -> None:
        """Fecha o `httpx.AsyncClient` se esta tool o criou."""
        if self._owns_client:
            await self._client.aclose()

    def with_config(self, handler_config: dict[str, Any]) -> CallbackTool:
        clone = type(self).__new__(type(self))
        clone.__dict__.update(self.__dict__)
        clone._handler_config = {
            **type(self).default_handler_config,
            **handler_config,
        }
        return clone

    # -------------------------------------------------------------------- wire
    @property
    def _url(self) -> str:
        """Endpoint interno do Node para esta tool."""
        base = self._settings.api_base_url.rstrip("/")
        return f"{base}/internal/tools/{self.key}"

    def _envelope(self, args: BaseModel, ctx: ToolContext) -> dict[str, Any]:
        """Corpo JSON do callback (o Node valida este envelope via Zod)."""
        return {
            "workspace_id": ctx.workspace_id,
            "conversation_id": ctx.conversation_id,
            "agent_id": ctx.agent_id,
            "execution_id": ctx.execution_id,
            "args": args.model_dump(mode="json"),
        }

    @staticmethod
    def _normalize(payload: dict[str, Any]) -> ToolResult:
        """Converte a resposta JSON do Node em `ToolResult`.

        Contrato do Node: `{ ok: bool, content?: str, error?: str, payload?: any }`.
        Tolerante a campos ausentes (defaults seguros).
        """
        ok = bool(payload.get("ok", False))
        content = payload.get("content")
        error = payload.get("error")
        return ToolResult(
            ok=ok,
            content=str(content) if content is not None else "",
            error=str(error) if (error is not None and not ok) else None,
            payload=payload.get("payload"),
        )

    # ------------------------------------------------------------------ execução
    async def _run(self, args: BaseModel, ctx: ToolContext) -> ToolResult:
        """Faz o callback ao Node. Trata sucesso / erro HTTP / timeout.

        Nunca levanta (o `Tool.execute` já é uma fronteira, mas aqui também não
        deixamos detalhes/PII/token vazarem para o modelo): toda falha vira um
        `ToolResult(ok=False, error=<msg estável>)`.
        """
        if ctx.is_playground:
            return ToolResult(
                ok=True,
                content=f"(simulado) Ação '{self.key}' não executada em playground.",
                payload={"simulated": True},
            )

        headers = {
            "Authorization": f"Bearer {self._settings.agent_runtime_token}",
            "Content-Type": "application/json",
        }
        try:
            resp = await self._client.post(
                self._url,
                headers=headers,
                json=self._envelope(args, ctx),
                timeout=self._timeout,
            )
        except httpx.TimeoutException:
            logger.warning(
                "callback tool {key}: timeout chamando o Node", key=self.key
            )
            return ToolResult(
                ok=False,
                error=f"Tempo esgotado ao executar '{self.key}'.",
            )
        except httpx.HTTPError:
            # Não logamos a exception inteira: a URL/headers podem conter contexto;
            # o sink redige Bearer, mas mantemos o log mínimo de propósito.
            logger.warning(
                "callback tool {key}: falha de transporte ao Node", key=self.key
            )
            return ToolResult(
                ok=False,
                error=f"Falha de comunicação ao executar '{self.key}'.",
            )

        if resp.status_code >= 400:
            logger.warning(
                "callback tool {key}: Node respondeu {status}",
                key=self.key,
                status=resp.status_code,
            )
            # Nunca repassa o corpo de erro do Node cru ao modelo.
            return ToolResult(
                ok=False,
                error=f"Não foi possível executar '{self.key}'.",
            )

        try:
            data = resp.json()
        except ValueError:
            logger.warning(
                "callback tool {key}: resposta do Node não é JSON", key=self.key
            )
            return ToolResult(
                ok=False,
                error=f"Resposta inválida ao executar '{self.key}'.",
            )

        if not isinstance(data, dict):
            return ToolResult(
                ok=False,
                error=f"Resposta inválida ao executar '{self.key}'.",
            )
        return self._normalize(data)
