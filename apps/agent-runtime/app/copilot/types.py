"""Contrato interno API ↔ runtime do Copiloto (spec `COPILOTO.md` §5.4).

Espelha `packages/shared/src/copilot/internal.ts` (Zod, F73-S02) campo a campo, em
snake_case. A entrada é **fechada** (`extra="forbid"`): campo desconhecido é 422, para
que uma divergência de contrato apareça no primeiro request e não vire comportamento
silencioso. Os eventos de saída são modelos pydantic serializados com
`model_dump(mode="json")`; o cliente Node valida cada frame com o Zod.

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
from typing import Annotated, Any, Literal, TypedDict

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

# ---------------------------------------------------------------------------
# Tipos base
# ---------------------------------------------------------------------------

# Nome de função aceito pelo formato OpenAI de function calling.
TOOL_KEY_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
_TOOL_KEY_RE = re.compile(TOOL_KEY_PATTERN)

# Nome reservado da ferramenta local de resposta estruturada (não passa pelo Node).
ANSWER_TOOL_NAME = "answer"

# Teto do JSON Schema de uma ferramenta (defesa de custo: o schema vai em todo request).
_MAX_TOOL_SCHEMA_BYTES = 16_384


def _canonical_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise ValueError("must be a UUID") from exc


Uuid = Annotated[str, AfterValidator(_canonical_uuid)]


class _Input(BaseModel):
    """Base dos modelos de entrada: fechados e imutáveis."""

    model_config = ConfigDict(extra="forbid", frozen=True)


# ---------------------------------------------------------------------------
# Request `POST /copilot/run`
# ---------------------------------------------------------------------------


class CopilotMember(_Input):
    display_name: str = Field(min_length=1, max_length=120)
    role_label: str = Field(min_length=1, max_length=60)
    locale: str = Field(default="pt-BR", min_length=2, max_length=35)
    timezone: str = Field(default="America/Sao_Paulo", min_length=1, max_length=64)


class CopilotPageContext(_Input):
    """Contexto de página já re-resolvido pela API sob o escopo do membro (§5.1).

    Pode conter nome de contato (texto de terceiro): o prompt o trata como `untrusted`.
    """

    label: str = Field(min_length=1, max_length=160)
    entity_summary: str | None = Field(default=None, max_length=2000)


class CopilotHistoryMessage(_Input):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class CopilotMemoryProfileEntry(_Input):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")
    content: str = Field(min_length=1, max_length=500)


class CopilotMemoryFact(_Input):
    id: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=500)
    source_label: str = Field(min_length=1, max_length=120)
    # `true` quando o fato veio de sistema de terceiro (`source_type='integration'`):
    # o prompt o delimita com spotlighting (F73-S10 §assemble).
    untrusted: bool = False


class CopilotMemory(_Input):
    profile: list[CopilotMemoryProfileEntry] = Field(default_factory=list, max_length=10)
    facts: list[CopilotMemoryFact] = Field(default_factory=list, max_length=30)


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
    """Limites do turno, resolvidos pela API (§5.4; defaults = spec)."""

    # `None` → `settings.copilot_default_model` (padrão da plataforma).
    model: str | None = Field(default=None, min_length=3, max_length=120)
    max_iterations: int = Field(default=8, ge=1, le=16)
    max_tool_calls: int = Field(default=16, ge=0, le=32)
    max_tokens_per_call: int = Field(default=1024, ge=64, le=8192)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    # Teto: o grant vale no máximo 120 s (ADR-003 §2); o turno não pode durar mais.
    turn_timeout_s: float = Field(default=60, gt=0, le=120)


class CopilotRunRequest(_Input):
    turn_id: Uuid
    workspace_id: Uuid
    grant: SecretStr = Field(min_length=16, max_length=4096)
    member: CopilotMember
    now_iso: AwareDatetime
    page_context_resolved: CopilotPageContext | None = None
    history: list[CopilotHistoryMessage] = Field(default_factory=list, max_length=12)
    memory: CopilotMemory = Field(default_factory=CopilotMemory)
    tools: list[CopilotToolDescriptor] = Field(default_factory=list, max_length=64)
    policy: CopilotPolicy = Field(default_factory=CopilotPolicy)
    user_input: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _unique_tool_keys(self) -> CopilotRunRequest:
        keys = [t.key for t in self.tools]
        if len(keys) != len(set(keys)):
            raise ValueError("tool keys must be unique")
        return self


# ---------------------------------------------------------------------------
# Resposta estruturada (blocos do `final`) — §5.3 `final.blocks`
# ---------------------------------------------------------------------------

VERDICT_MAX_CHARS = 220
WHY_MAX_ITEMS = 3
WHY_MAX_CHARS = 280
NEXT_STEPS_MAX_ITEMS = 3
DATA_REFS_MAX_ITEMS = 12
SOURCES_MAX_ITEMS = 8


class AnswerSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(max_length=120)
    as_of: str = Field(max_length=64)


class NextStepAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["navigate", "ask"]
    value: str = Field(max_length=300)


class NextStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(max_length=120)
    # Ausente no wire quando não há ação (`action?:` no Zod; `null` seria recusado).
    action: NextStepAction | None = Field(default=None, exclude_if=lambda v: v is None)


class AnswerBlocks(BaseModel):
    """Veredito → por quê → dados (refs) → fonte → próximo passo."""

    model_config = ConfigDict(extra="forbid")

    verdict: str = Field(max_length=VERDICT_MAX_CHARS)
    why: list[str] = Field(default_factory=list, max_length=WHY_MAX_ITEMS)
    data_refs: list[str] = Field(default_factory=list, max_length=DATA_REFS_MAX_ITEMS)
    sources: list[AnswerSource] = Field(default_factory=list, max_length=SOURCES_MAX_ITEMS)
    next_steps: list[NextStep] = Field(default_factory=list, max_length=NEXT_STEPS_MAX_ITEMS)


# ---------------------------------------------------------------------------
# Eventos internos (runtime → API), união discriminada por `type`
# ---------------------------------------------------------------------------


class CopilotUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_cost_usd: float = 0.0


class StatusEvent(BaseModel):
    type: Literal["status"] = "status"
    tool_key: str


class VerdictDeltaEvent(BaseModel):
    type: Literal["verdict_delta"] = "verdict_delta"
    text: str


class ToolCallCompletedEvent(BaseModel):
    type: Literal["tool_call_completed"] = "tool_call_completed"
    tool_key: str
    call_id: str
    # Resposta do Node, repassada como veio (`CopilotToolEnvelope`). Em falha de
    # transporte, um envelope sintético `{ok: false, decision: 'error', model_view}`.
    envelope: dict[str, Any]


class FinalEvent(BaseModel):
    type: Literal["final"] = "final"
    blocks: AnswerBlocks
    usage: CopilotUsage
    iterations: int
    format_fallback: bool = False


class IterationExceededEvent(BaseModel):
    type: Literal["iteration_exceeded"] = "iteration_exceeded"


ErrorCode = Literal["timeout", "provider_error", "internal"]


class ErrorEvent(BaseModel):
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
