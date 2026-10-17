"""Contrato interno API ↔ runtime do Copiloto (spec `COPILOTO.md` §5.4).

Espelha `packages/shared/src/copilot/internal.ts` (Zod, F73-S02) campo a campo, em
snake_case. A entrada é **fechada** (`extra="forbid"`): campo desconhecido é 422, para
que uma divergência de contrato apareça no primeiro request e não vire comportamento
silencioso. Os eventos de saída também são fechados e serializados com
`model_dump(mode="json")`; o cliente Node valida cada frame com o Zod.

Regra de direção: todo request que o Zod aceita, o runtime aceita (com uma folga só:
`policy.model = null` cai no padrão da plataforma); todo evento que o runtime emite, o
Zod aceita (o runtime emite um subconjunto: veredito ≤ 220 em vez de 500, códigos de
erro fechados em vez do regex aberto). As únicas regras de entrada a mais que o Zod são
invariantes que o Node nunca viola: `answer` reservado, chaves de ferramenta únicas e
`parameters` com `type: "object"` e ≤ 16 KB (o Node gera de um `z.object().strict()`).

Segurança:
- `grant` é `SecretStr`: não aparece em `repr`, em `model_dump` nem em log por acidente.
  Só `tools.CopilotCallbackTool` lê o valor, para montar o header `X-Copilot-Grant`.
- Os limites de tamanho (histórico ≤ 12, fatos ≤ 30, textos com teto) são defesa de
  custo e de prompt-flooding no próprio runtime, além da validação do Node.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Mapping
from datetime import datetime
from types import MappingProxyType
from typing import Annotated, Any, Final, Literal, TypedDict, get_args

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    StrictBool,
    field_validator,
    model_validator,
)

# ---------------------------------------------------------------------------
# Tipos base
# ---------------------------------------------------------------------------

# `CopilotToolKeySchema` (Zod): snake_case minúsculo, ≤ 64. Também é nome de função
# válido no formato OpenAI e o `:key` do callback (sem `.`, `/` nem `-`).
TOOL_KEY_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"
_TOOL_KEY_RE = re.compile(TOOL_KEY_PATTERN)

# Nome reservado da ferramenta local de resposta estruturada (não passa pelo Node).
ANSWER_TOOL_NAME = "answer"

# Teto do JSON Schema de uma ferramenta (defesa de custo: o schema vai em todo request).
_MAX_TOOL_SCHEMA_BYTES = 16_384


# `UuidSchema` (Zod 3 `z.string().uuid()`): só a forma hifenizada de 36 caracteres. O
# `uuid.UUID` do Python aceitaria também `{…}`, `urn:uuid:` e hex corrido, que o Zod recusa.
UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
_UUID_RE = re.compile(UUID_PATTERN)


def _canonical_uuid(value: str) -> str:
    if not _UUID_RE.match(value):
        raise ValueError("must be a UUID")
    return str(uuid.UUID(value))


Uuid = Annotated[str, AfterValidator(_canonical_uuid)]

# `COPILOT_POLICY_LIMITS` (Zod): tetos duros por turno (R5). O Node também conta.
_MAX_ITERATIONS: Final = 8
_MAX_TOOL_CALLS: Final = 16
_TURN_TIMEOUT_S: Final = 60
_HISTORY_MAX: Final = 12
_MEMORY_FACTS_MAX: Final = 30
COPILOT_POLICY_LIMITS: Final[Mapping[str, int]] = MappingProxyType(
    {
        "max_iterations": _MAX_ITERATIONS,
        "max_tool_calls": _MAX_TOOL_CALLS,
        "turn_timeout_s": _TURN_TIMEOUT_S,
        "history_max": _HISTORY_MAX,
        "memory_facts_max": _MEMORY_FACTS_MAX,
    }
)

# `COPILOT_MEMORY_PROFILE_KEYS` e `COPILOT_TOOL_CALL_DECISIONS` (statuses.ts).
MemoryProfileKey = Literal["what_we_sell", "avg_ticket", "tone", "hours", "commercial_rules"]
MEMORY_PROFILE_KEYS: Final = get_args(MemoryProfileKey)
ToolCallDecision = Literal["executed", "proposed", "blocked", "denied", "invalid_args", "error"]

# `CopilotToolKeySchema` como tipo anotado (eventos de saída).
ToolKey = Annotated[str, Field(pattern=TOOL_KEY_PATTERN)]


class _Input(BaseModel):
    """Base dos modelos de entrada: fechados e imutáveis."""

    model_config = ConfigDict(extra="forbid", frozen=True)


# ---------------------------------------------------------------------------
# Request `POST /copilot/run`
# ---------------------------------------------------------------------------


class CopilotMember(_Input):
    display_name: str = Field(min_length=1, max_length=120)
    role_label: str = Field(min_length=1, max_length=80)
    locale: str = Field(min_length=2, max_length=35)
    timezone: str = Field(min_length=1, max_length=64)


class CopilotPageContext(_Input):
    """Contexto de página já re-resolvido pela API sob o escopo do membro (§5.1).

    Pode conter nome de contato (texto de terceiro): o prompt o trata como `untrusted`.
    """

    label: str = Field(min_length=1, max_length=160)
    entity_summary: str | None = Field(default=None, max_length=1000)


class CopilotHistoryMessage(_Input):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class CopilotMemoryProfileEntry(_Input):
    key: MemoryProfileKey
    content: str = Field(min_length=1, max_length=500)


class CopilotMemoryFact(_Input):
    id: Uuid
    content: str = Field(min_length=1, max_length=500)
    source_label: str = Field(min_length=1, max_length=200)
    # `true` quando o fato veio de sistema de terceiro (`source_type='integration'`):
    # o prompt o delimita com spotlighting (F73-S10 §assemble). Ausente = `false` (Zod
    # `.optional()`).
    untrusted: StrictBool = False


class CopilotMemory(_Input):
    profile: list[CopilotMemoryProfileEntry] = Field(max_length=len(MEMORY_PROFILE_KEYS))
    facts: list[CopilotMemoryFact] = Field(max_length=_MEMORY_FACTS_MAX)


class CopilotToolDescriptor(_Input):
    """Ferramenta oferecida ao modelo: só as permitidas ao membro (ADR-003 §3).

    `parameters` é o JSON Schema dos args (gerado no Node por `z.toJSONSchema`). O
    runtime não valida os args contra ele: quem valida é o Node (Zod `.strict()`), que
    é a fonte da verdade. Aqui o schema só precisa ser um objeto JSON Schema plausível.
    """

    key: str = Field(pattern=TOOL_KEY_PATTERN)
    description: str = Field(min_length=1, max_length=1024)
    parameters: dict[str, Any]

    @field_validator("key")
    @classmethod
    def _not_reserved(cls, value: str) -> str:
        if value == ANSWER_TOOL_NAME:
            raise ValueError(f"'{ANSWER_TOOL_NAME}' is reserved for the local answer tool")
        return value

    @field_validator("parameters")
    @classmethod
    def _object_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        if value.get("type") != "object":
            raise ValueError("parameters must be a JSON Schema with type 'object'")
        props = value.get("properties", {})
        if not isinstance(props, dict):
            raise ValueError("parameters.properties must be an object")
        if len(json.dumps(value, separators=(",", ":"))) > _MAX_TOOL_SCHEMA_BYTES:
            raise ValueError("parameters schema too large")
        return value


class CopilotPolicy(_Input):
    """Limites do turno, resolvidos pela API (§5.4; tetos = `COPILOT_POLICY_LIMITS`).

    Os tetos são os do Zod, não mais frouxos: o runtime é a última barreira do loop de
    custo (R5) e não aceita uma policy que o contrato recusaria. Todos os campos são
    obrigatórios, como no Zod.
    """

    # Única folga deliberada em relação ao Zod (que exige string): `null` cai no padrão
    # da plataforma (`settings.copilot_default_model`) em vez de derrubar o turno. É
    # folga só na entrada; todo request válido pelo Zod continua válido aqui.
    model: str | None = Field(min_length=1, max_length=120)
    max_iterations: int = Field(ge=1, le=_MAX_ITERATIONS)
    max_tool_calls: int = Field(ge=0, le=_MAX_TOOL_CALLS)
    max_tokens_per_call: int = Field(ge=1, le=32_000)
    temperature: float = Field(ge=0.0, le=2.0)
    turn_timeout_s: int = Field(ge=1, le=_TURN_TIMEOUT_S)


class CopilotRunRequest(_Input):
    """`CopilotRunRequestSchema`. Todos os campos obrigatórios, como no Zod."""

    turn_id: Uuid
    workspace_id: Uuid
    grant: SecretStr = Field(min_length=1, max_length=2048)
    member: CopilotMember
    now_iso: AwareDatetime
    page_context_resolved: CopilotPageContext
    history: list[CopilotHistoryMessage] = Field(max_length=_HISTORY_MAX)
    memory: CopilotMemory
    tools: list[CopilotToolDescriptor] = Field(max_length=64)
    policy: CopilotPolicy
    user_input: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def _unique_tool_keys(self) -> CopilotRunRequest:
        keys = [t.key for t in self.tools]
        if len(keys) != len(set(keys)):
            raise ValueError("tool keys must be unique")
        return self


# ---------------------------------------------------------------------------
# Resposta estruturada (blocos do `final`) — §5.3 `final.blocks`
# ---------------------------------------------------------------------------

# Tetos de `CopilotAnswerBlocksSchema` (Zod). O veredito pedido ao modelo é 220; o Zod
# aceita 500 por causa do fallback de formato, mas o runtime sempre corta em 220.
VERDICT_MAX_CHARS = 220
WHY_MAX_ITEMS = 3
WHY_MAX_CHARS = 300
NEXT_STEPS_MAX_ITEMS = 3
NEXT_STEP_LABEL_MAX_CHARS = 80
ASK_MAX_CHARS = 2000
NAVIGATE_MAX_CHARS = 300
DATA_REFS_MAX_ITEMS = 20
SOURCES_MAX_ITEMS = 10
SOURCE_LABEL_MAX_CHARS = 160

# `ResultIdSchema` (Zod): id de resultado gerado pelo Node.
RESULT_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
# `InternalRouteSchema` (Zod, R4): começa com `/`, sem `//`, sem espaço nem `\`.
INTERNAL_ROUTE_PATTERN = r"^/(?!/)[^\s\\]*$"
_INTERNAL_ROUTE_RE = re.compile(INTERNAL_ROUTE_PATTERN)
# `IsoDateTimeSchema` (Zod `datetime({ offset: true })`), na forma que o runtime emite:
# segundos obrigatórios e offset `Z` ou `±HH:MM` (subconjunto estrito do que o Zod aceita).
ISO_DATETIME_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"
_ISO_DATETIME_RE = re.compile(ISO_DATETIME_PATTERN)


def is_iso_datetime(value: str) -> bool:
    """Instante ISO 8601 com fuso, no formato do padrão e com data/hora reais."""
    if not _ISO_DATETIME_RE.match(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def is_internal_route(value: str) -> bool:
    return 1 <= len(value) <= NAVIGATE_MAX_CHARS and bool(_INTERNAL_ROUTE_RE.match(value))


def _iso_datetime(value: str) -> str:
    if not is_iso_datetime(value):
        raise ValueError("must be an ISO 8601 datetime with offset")
    return value


IsoDateTime = Annotated[str, AfterValidator(_iso_datetime)]


class AnswerSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=SOURCE_LABEL_MAX_CHARS)
    as_of: IsoDateTime


class NextStepAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["navigate", "ask"]
    value: str = Field(min_length=1, max_length=ASK_MAX_CHARS)

    @model_validator(mode="after")
    def _internal_route(self) -> NextStepAction:
        if self.kind == "navigate" and not is_internal_route(self.value):
            raise ValueError("navigate must target an internal route")
        return self


class NextStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=NEXT_STEP_LABEL_MAX_CHARS)
    # Ausente no wire quando não há ação (`action?:` no Zod; `null` seria recusado).
    action: NextStepAction | None = Field(default=None, exclude_if=lambda v: v is None)


class AnswerBlocks(BaseModel):
    """Veredito → por quê → dados (refs) → fonte → próximo passo."""

    model_config = ConfigDict(extra="forbid")

    verdict: str = Field(max_length=VERDICT_MAX_CHARS)
    why: list[Annotated[str, Field(min_length=1, max_length=WHY_MAX_CHARS)]] = Field(
        default_factory=list, max_length=WHY_MAX_ITEMS
    )
    data_refs: list[Annotated[str, Field(pattern=RESULT_ID_PATTERN)]] = Field(
        default_factory=list, max_length=DATA_REFS_MAX_ITEMS
    )
    sources: list[AnswerSource] = Field(default_factory=list, max_length=SOURCES_MAX_ITEMS)
    next_steps: list[NextStep] = Field(default_factory=list, max_length=NEXT_STEPS_MAX_ITEMS)


# ---------------------------------------------------------------------------
# Eventos internos (runtime → API), união discriminada por `type`
# ---------------------------------------------------------------------------


class CopilotUsage(BaseModel):
    """`CopilotRunUsageSchema`. `total_cost_usd` é `null` quando o OpenRouter não informou
    o custo de alguma chamada do turno: soma parcial seria um número errado com cara de
    certo, e a API grava `llm_usage_logs` a partir daqui (F73-S10)."""

    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_cost_usd: float | None = Field(default=0.0, ge=0)


# ---------------------------------------------------------------------------
# Envelope do callback (`CopilotToolEnvelopeSchema`)
# ---------------------------------------------------------------------------

MODEL_VIEW_MAX_CHARS = 24_576
CALL_ID_MAX_CHARS = 128

# Tipos de `CopilotToolPublicEventSchema`: o `tool_result` (cartão) e os três eventos de ação.
PublicEventType = Literal["tool_result", "action_receipt", "action_proposed", "action_blocked"]


class CopilotToolPublicEvent(BaseModel):
    """`public_event` do envelope: o que o Node manda ao navegador (P5).

    O Node gera e valida o evento inteiro com o Zod (cartões por `kind`, propostas); o
    runtime não o lê, só o repassa. Aqui se confere o envelope mínimo (`v`, `type`) e o
    resto passa intacto (`extra="allow"`), para não duplicar em Python dez esquemas de
    cartão que mudam do lado do produto.
    """

    model_config = ConfigDict(extra="allow")

    v: Literal[1]
    type: PublicEventType


class CopilotToolEnvelope(BaseModel):
    """Resposta do callback `POST {API}/internal/copilot/tools/:key`.

    Fechado como o Zod: um campo a mais (ex.: o antigo `untrusted` no topo) é envelope
    fora do contrato e vira falha segura em `tools.CopilotCallbackTool`. Dado de terceiro
    vem marcado DENTRO do `model_view` (chave `untrusted`), que é forma livre.
    """

    model_config = ConfigDict(extra="forbid")

    ok: StrictBool
    decision: ToolCallDecision
    result_id: Annotated[str, Field(pattern=RESULT_ID_PATTERN)] | None = Field(
        default=None, exclude_if=lambda v: v is None
    )
    model_view: Annotated[str, Field(max_length=MODEL_VIEW_MAX_CHARS)] | dict[str, Any]
    public_event: CopilotToolPublicEvent | None = Field(
        default=None, exclude_if=lambda v: v is None
    )


# ---------------------------------------------------------------------------
# Eventos runtime → API (`CopilotRuntimeEventSchema`), fechados como no Zod
# ---------------------------------------------------------------------------


class _Event(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StatusEvent(_Event):
    type: Literal["status"] = "status"
    tool_key: ToolKey


class VerdictDeltaEvent(_Event):
    type: Literal["verdict_delta"] = "verdict_delta"
    text: str = Field(min_length=1, max_length=2000)


class ToolCallCompletedEvent(_Event):
    type: Literal["tool_call_completed"] = "tool_call_completed"
    tool_key: ToolKey
    call_id: str = Field(min_length=1, max_length=CALL_ID_MAX_CHARS)
    # Resposta do Node, repassada como veio. Em falha de transporte ou de contrato, um
    # envelope sintético `{ok: false, decision: 'error', model_view}`.
    envelope: CopilotToolEnvelope


class FinalEvent(_Event):
    type: Literal["final"] = "final"
    blocks: AnswerBlocks
    usage: CopilotUsage
    iterations: int = Field(ge=0)
    # Zod: `.optional()`. O runtime sempre informa, para a métrica da S15 não ter buraco.
    format_fallback: bool = False


class IterationExceededEvent(_Event):
    type: Literal["iteration_exceeded"] = "iteration_exceeded"


# O Zod aceita qualquer `^[a-z][a-z0-9_]{0,63}$` (a API mapeia para o conjunto público e
# código desconhecido vira `internal`). O runtime só emite estes três.
ErrorCode = Literal["timeout", "provider_error", "internal"]


class ErrorEvent(_Event):
    type: Literal["error"] = "error"
    code: ErrorCode


CopilotRuntimeEvent = Annotated[
    StatusEvent
    | VerdictDeltaEvent
    | ToolCallCompletedEvent
    | FinalEvent
    | IterationExceededEvent
    | ErrorEvent,
    Field(discriminator="type"),
]


def event_payload(event: BaseModel) -> dict[str, Any]:
    """Serialização canônica de um evento para o wire (JSON-safe, snake_case)."""
    return event.model_dump(mode="json")


# ---------------------------------------------------------------------------
# State do grafo
# ---------------------------------------------------------------------------


def append_list(left: list[Any] | None, right: list[Any] | None) -> list[Any]:
    """Reducer de append simples (mensagens e result_ids)."""
    return [*(left or []), *(right or [])]


class CopilotState(TypedDict, total=False):
    """State do grafo do Copiloto. Vive só em memória durante o turno (sem checkpointer)."""

    request: CopilotRunRequest
    model: str
    # Mensagens no formato OpenAI (dicts), anexadas por cada node.
    messages: Annotated[list[dict[str, Any]], append_list]
    # Tool calls pendentes da última resposta do modelo (exceto `answer`).
    pending_tool_calls: list[dict[str, str]]
    # Args crus da chamada `answer` (string JSON) e o veredito já emitido em stream.
    answer_arguments: str | None
    streamed_verdict: str
    # Último texto livre do modelo (para o fallback de formato).
    last_text: str | None
    # `result_id`s devolvidos pelo Node neste turno (únicos aceitos em `data_refs`).
    result_ids: Annotated[list[str], append_list]
    iterations: int
    tool_calls_made: int
    force_answer: bool
    iteration_exceeded: bool
    usage: CopilotUsage
    failed: bool


def is_valid_tool_key(key: str) -> bool:
    return bool(_TOOL_KEY_RE.match(key))
