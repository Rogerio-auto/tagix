"""Tipos load-bearing do grafo LangGraph: State, mensagens, policy, eventos de stream.

> **Slot:** F2-S05 — `docs/AGENTS_LANGGRAPH.md` §3.1, §10.2.

O `AgentState` é o objeto que flui pelo `StateGraph`. Cada node retorna um *patch*
(dict parcial); reducers anotados (`Annotated[..., add_messages]`) fundem listas.
Quebrar o shape do `AgentState`/`PolicySnapshot` = quebrar execuções salvas no
checkpoint (state serializado em `agent_checkpoints`) e invocações em produção.

Convenção de wire (request `/run` + eventos SSE): **snake_case** (Pydantic), espelhada
1:1 por `packages/agents-client/src/types.ts` (Zod). Os dois lados são validados.

`ToolRegistry` (Protocol) é a **costura** entre este grafo e as tools concretas
(F2-S06/S07/S20): o grafo NUNCA importa tools — recebe o registry por injeção em
`build_graph(...)`. Contrato fixo, acordado com F2-S06.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any, Literal, Protocol, TypedDict, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from collections.abc import Sequence

# ---------------------------------------------------------------------------
# Mensagens — espelha ChatMessage do cliente Zod (agents-client §3.1).
# ---------------------------------------------------------------------------

ChatRole = Literal["system", "user", "assistant", "tool"]


class ChatMessage(BaseModel):
    """Uma mensagem do histórico no formato OpenAI/OpenRouter.

    `tool_calls` é a lista crua (formato OpenAI) que o assistant emitiu; o
    `tool_dispatch` a consome. `tool_call_id`/`name` aparecem em mensagens `tool`
    (resultado de uma tool, correlacionado pelo id).
    """

    model_config = ConfigDict(extra="ignore")

    role: ChatRole
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None

    def to_openai(self) -> dict[str, Any]:
        """Serializa para o dict que vai no body do OpenRouter (sem chaves None)."""
        msg: dict[str, Any] = {"role": self.role}
        # `content` é obrigatório no protocolo OpenAI mesmo quando é None numa
        # assistant-com-tool_calls; mantemos a chave (None) para não quebrar o schema.
        msg["content"] = self.content
        if self.tool_calls:
            msg["tool_calls"] = self.tool_calls
        if self.tool_call_id is not None:
            msg["tool_call_id"] = self.tool_call_id
        if self.name is not None:
            msg["name"] = self.name
        return msg


def append_messages(
    left: Sequence[ChatMessage] | None,
    right: Sequence[ChatMessage] | None,
) -> list[ChatMessage]:
    """Reducer do canal `messages`: ANEXA `right` em `left` (append simples).

    Não usamos `langgraph.graph.message.add_messages` de propósito: aquele reducer
    coage para os tipos `BaseMessage` da LangChain (e rejeita nosso `ChatMessage`
    Pydantic). Aqui o canal carrega `ChatMessage` puro — o formato OpenAI que o
    provider e o `tool_dispatch` consomem direto. Append é suficiente: build_prompt
    semeia a lista inicial (canal vazio) e os nodes seguintes só adicionam.
    """
    base = list(left or [])
    base.extend(right or [])
    return base


# ---------------------------------------------------------------------------
# Policy snapshot — resolvido pelo Node, reaplicado defensivamente pelo runtime.
# Espelha PolicySnapshotSchema (agents-client) campo-a-campo.
# ---------------------------------------------------------------------------


class PolicySnapshot(BaseModel):
    """Snapshot de policy do workspace (super-admin → Node → runtime).

    `remaining_monthly_budget_usd = None` significa "sem cap". Load-bearing:
    persistido no checkpoint junto do state.
    """

    model_config = ConfigDict(extra="ignore")

    allowed_models: list[str] = Field(default_factory=list)
    allow_streaming: bool = True
    allow_interrupts: bool = False
    allow_parallel_tools: bool = True
    allow_vision: bool = False
    allow_transcription: bool = False
    max_iterations: int = 5
    max_tokens_per_call: int = 2048
    max_tools_per_agent: int = 16
    allowed_tool_categories: list[str] = Field(default_factory=list)
    remaining_monthly_budget_usd: float | None = None


# ---------------------------------------------------------------------------
# Descritor de tool (resolvido pelo Node, passado ao runtime — §8.1).
# ---------------------------------------------------------------------------


class ToolDescriptor(BaseModel):
    """Tool habilitada para o agente (categoria + config), vinda do Node.

    `config` é arbitrário (column-level ACL etc., §6.5). O grafo NÃO interpreta
    `config`; ele só carrega `key`/`category` para filtro de policy e repassa o
    descriptor ao registry no dispatch.
    """

    model_config = ConfigDict(extra="ignore")

    key: str
    name: str = ""
    description: str = ""
    category: str = ""
    config: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Acúmulo de usage ao longo do loop (somado em cada call_model).
# ---------------------------------------------------------------------------


class UsageAccumulator(BaseModel):
    """Tokens + custo agregados de TODAS as chamadas LLM de uma execução.

    Mapeia 1:1 ao `UsageSchema` do cliente (campo `total_cost_usd`). O evento
    `final` carrega isto serializado.
    """

    model_config = ConfigDict(extra="ignore")

    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0


# ---------------------------------------------------------------------------
# AgentState — o objeto do StateGraph.
# ---------------------------------------------------------------------------


class AgentState(TypedDict, total=False):
    """State do grafo. `total=False`: nodes preenchem incrementalmente via patch.

    `messages` usa o reducer `add_messages` do LangGraph: um node que retorna
    `{"messages": [m]}` *anexa* (não substitui). Os demais campos são last-write-wins.
    """

    # identidade
    workspace_id: str
    agent_id: str
    conversation_id: str | None
    contact_id: str | None
    thread_id: str
    execution_id: str
    is_playground: bool

    # policy (snapshot resolvido pelo Node)
    policy: PolicySnapshot

    # I/O
    user_input: str
    # histórico carregado no request (NÃO acumula via reducer): build_prompt o lê
    # e monta a lista canônica em `messages`. Last-write-wins.
    history: list[ChatMessage]
    # mensagens vivas da execução. `append_messages` ANEXA cada patch (assistant do
    # call_model, tool results do tool_dispatch). build_prompt semeia o conjunto
    # inicial quando `messages` ainda está vazio.
    messages: Annotated[list[ChatMessage], append_messages]

    # contexto resolvido (load_context)
    agent: dict[str, Any]
    contact: dict[str, Any] | None
    conversation: dict[str, Any] | None
    tools: list[ToolDescriptor]

    # controle de loop
    iteration: int
    should_handoff: bool
    handoff_reason: str | None

    # bloqueios (defesa-em-profundidade no runtime)
    model_blocked_reason: str | None
    budget_exceeded: bool

    # saída
    final_reply: str | None
    usage: UsageAccumulator
    generation_id: str | None

    # diagnóstico
    tool_calls_executed: list[dict[str, Any]]
    errors: list[str]


# ---------------------------------------------------------------------------
# ToolRegistry (Protocol) — CONTRATO com F2-S06. Obedecer exatamente.
# ---------------------------------------------------------------------------


@runtime_checkable
class ToolRegistry(Protocol):
    """Seam injetável entre o grafo e as tools concretas (F2-S06/S07/S20).

    O grafo recebe uma instância via `build_graph(tool_registry=...)` e NUNCA
    importa as tools diretamente. Apenas dois métodos compõem o contrato:

    - `specs_for(allowed_keys)` — **síncrono**. Devolve a lista de specs de
      function-calling no formato OpenAI (`{"type": "function", "function": {...}}`).
      `allowed_keys=None` → todas as tools registradas. Caso contrário, só as
      chaves no conjunto. `build_prompt`/`call_model` usam isto para montar o
      campo `tools` da requisição ao OpenRouter.

    - `dispatch(key, args, ctx)` — **async**. Executa a tool de chave `key` com
      os `args` (dict já desserializado dos `tool_calls` do modelo) e o `ctx`
      de execução. Retorna `{"ok": bool, "content": str, "error": str | None}`.
      `ctx` é o dict construído pelo `tool_dispatch`:
      `{"workspace_id", "conversation_id", "agent_id", "execution_id"}`
      (mais `is_playground` para o modo simulação).
    """

    def specs_for(self, allowed_keys: set[str] | None) -> list[dict[str, Any]]:
        """Specs OpenAI function-calling das tools (sync). `None` = todas."""
        ...

    async def dispatch(self, key: str, args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
        """Executa a tool. Retorna `{"ok", "content", "error"}`."""
        ...


# ---------------------------------------------------------------------------
# Eventos de stream (SSE) — discriminated union por `type` (snake_case).
# Espelha AgentStreamEventSchema (agents-client). O cliente F2-S03 valida estes.
# ---------------------------------------------------------------------------


class TokenEvent(BaseModel):
    type: Literal["token"] = "token"
    content: str


class ToolCallStartedEvent(BaseModel):
    type: Literal["tool_call_started"] = "tool_call_started"
    tool_key: str
    args: Any = None


class ToolCallCompletedEvent(BaseModel):
    type: Literal["tool_call_completed"] = "tool_call_completed"
    tool_key: str
    result: Any = None
    duration_ms: int = 0


class InterruptEvent(BaseModel):
    type: Literal["interrupt"] = "interrupt"
    reason: str
    tool_key: str
    args: Any = None


class IterationExceededEvent(BaseModel):
    type: Literal["iteration_exceeded"] = "iteration_exceeded"


class BudgetExceededEvent(BaseModel):
    type: Literal["budget_exceeded"] = "budget_exceeded"


class ModelBlockedEvent(BaseModel):
    type: Literal["model_blocked"] = "model_blocked"
    reason: str


class FinalEvent(BaseModel):
    type: Literal["final"] = "final"
    reply: str
    usage: UsageAccumulator
    openrouter_generation_id: str | None = None


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str


StreamEvent = (
    TokenEvent
    | ToolCallStartedEvent
    | ToolCallCompletedEvent
    | InterruptEvent
    | IterationExceededEvent
    | BudgetExceededEvent
    | ModelBlockedEvent
    | FinalEvent
    | ErrorEvent
)
