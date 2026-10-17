"""Ferramenta **local** `answer`: a forma de a resposta sair estruturada.

> **source:** `COPILOTO.md` §2 (P5, P6), §7 ("formato fixo") · slot F73-S04.

`answer` não é capacidade e não passa pelo Node. O modelo é instruído (e, no último
passo, forçado via `tool_choice`) a terminar **sempre** chamando `answer` com:

    { verdict (≤ 220), why: string[] ≤ 3, data_refs: string[],
      sources: { label, as_of }[], next_steps: { label, action? }[] ≤ 3 }

Três peças vivem aqui:

1. `VerdictStreamer`: alimentado com os deltas dos argumentos de `answer` durante o
   stream; devolve o texto novo do `verdict` assim que é decodificável (parser
   incremental de `partial_json`). Normaliza espaços e respeita o teto de 220 com a
   mesma regra de `clamp_verdict`, de modo que **a concatenação dos deltas é sempre
   igual ao `verdict` final**.
2. `blocks_from_answer_args`: valida os args de forma tolerante (item inválido cai,
   o resto fica) e remove `data_refs` que não vieram de `tool_call_completed` deste
   turno: o modelo só referencia o que o Node devolveu (P5).
3. `fallback_blocks`: quando o modelo responde em texto livre (ou o turno estoura o
   teto), monta os blocos com `verdict` = primeira frase e o turno sai com
   `format_fallback=true`.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any, Final

from app.copilot.partial_json import TopLevelStringFieldStreamer
from app.copilot.types import (
    ANSWER_TOOL_NAME,
    DATA_REFS_MAX_ITEMS,
    NEXT_STEP_LABEL_MAX_CHARS,
    NEXT_STEPS_MAX_ITEMS,
    SOURCE_LABEL_MAX_CHARS,
    SOURCES_MAX_ITEMS,
    VERDICT_MAX_CHARS,
    WHY_MAX_CHARS,
    WHY_MAX_ITEMS,
    AnswerBlocks,
    AnswerSource,
    NextStep,
    NextStepAction,
    is_internal_route,
    is_iso_datetime,
)

# Veredito quando não há nada aproveitável do modelo (ex.: só chamou ferramentas até o teto).
NO_ANSWER_VERDICT: Final = (
    "Não consegui concluir a resposta dentro do limite deste pedido. "
    "Tente uma pergunta mais específica."
)

_WS_TRANSLATION: Final = {ord("\n"): " ", ord("\r"): " ", ord("\t"): " "}
_SENTENCE_END: Final = frozenset(".!?…")

# ---------------------------------------------------------------------------
# Spec da ferramenta para o modelo
# ---------------------------------------------------------------------------

ANSWER_TOOL_SPEC: Final[dict[str, Any]] = {
    "type": "function",
    "function": {
        "name": ANSWER_TOOL_NAME,
        "description": (
            "Entrega a resposta final à pessoa, no formato fixo. Chame SEMPRE para "
            "terminar, exatamente uma vez, depois de usar as ferramentas necessárias."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["verdict", "why", "data_refs", "sources", "next_steps"],
            "properties": {
                "verdict": {
                    "type": "string",
                    "maxLength": VERDICT_MAX_CHARS,
                    "description": "Uma frase com a conclusão. Sem saudação.",
                },
                "why": {
                    "type": "array",
                    "maxItems": WHY_MAX_ITEMS,
                    "items": {"type": "string", "maxLength": WHY_MAX_CHARS},
                    "description": "Até 3 linhas curtas, cada uma com o número que sustenta.",
                },
                "data_refs": {
                    "type": "array",
                    "maxItems": DATA_REFS_MAX_ITEMS,
                    "items": {"type": "string"},
                    "description": "result_id devolvidos pelas ferramentas neste turno.",
                },
                "sources": {
                    "type": "array",
                    "maxItems": SOURCES_MAX_ITEMS,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["label", "as_of"],
                        "properties": {
                            "label": {"type": "string", "maxLength": SOURCE_LABEL_MAX_CHARS},
                            "as_of": {
                                "type": "string",
                                "description": "Instante ISO 8601 com fuso, copiado da ferramenta.",
                            },
                        },
                    },
                    "description": "Fontes usadas, com o horário (as_of) vindo da ferramenta.",
                },
                "next_steps": {
                    "type": "array",
                    "maxItems": NEXT_STEPS_MAX_ITEMS,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["label"],
                        "properties": {
                            "label": {"type": "string", "maxLength": NEXT_STEP_LABEL_MAX_CHARS},
                            "action": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["kind", "value"],
                                "properties": {
                                    "kind": {"type": "string", "enum": ["navigate", "ask"]},
                                    "value": {
                                        "type": "string",
                                        "description": (
                                            "navigate: rota interna começando com '/'. "
                                            "ask: a próxima pergunta sugerida."
                                        ),
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
}


# ---------------------------------------------------------------------------
# Veredito: normalização canônica + streaming
# ---------------------------------------------------------------------------


def clamp_verdict(text: str) -> str:
    """Forma canônica do veredito: uma linha, sem bordas, ≤ 220 sem cortar em espaço."""
    flat = text.translate(_WS_TRANSLATION).strip()
    return flat[:VERDICT_MAX_CHARS].rstrip()


class VerdictStreamer:
    """Emite o `verdict` em deltas durante o stream dos args de `answer`.

    Invariante: `"".join(deltas) == clamp_verdict(verdict_decodificado)`. Espaços são
    retidos até aparecer o próximo caractere visível (assim borda final nunca vaza), e
    um delta só sai se couber inteiro no teto de 220 — exatamente a regra de
    `clamp_verdict`.
    """

    def __init__(self) -> None:
        self._parser = TopLevelStringFieldStreamer("verdict")
        self._pending_ws = ""
        self._emitted: list[str] = []
        self._length = 0
        self._capped = False

    @property
    def text(self) -> str:
        return "".join(self._emitted)

    def feed(self, chunk: str) -> str:
        decoded = self._parser.feed(chunk)
        if not decoded or self._capped:
            return ""
        out: list[str] = []
        for ch in decoded.translate(_WS_TRANSLATION):
            if ch.isspace():
                if self._length > 0:
                    self._pending_ws += ch
                continue
            piece = self._pending_ws + ch
            if self._length + len(piece) > VERDICT_MAX_CHARS:
                self._capped = True
                break
            self._pending_ws = ""
            self._length += len(piece)
            out.append(piece)
        delta = "".join(out)
        if delta:
            self._emitted.append(delta)
        return delta


# ---------------------------------------------------------------------------
# Args de `answer` → AnswerBlocks
# ---------------------------------------------------------------------------


def _clean_str(value: Any, *, max_chars: int) -> str | None:
    if not isinstance(value, str):
        return None
    flat = value.translate(_WS_TRANSLATION).strip()
    if not flat:
        return None
    if len(flat) > max_chars:
        flat = flat[: max_chars - 1].rstrip() + "…"
    return flat


def _safe_navigate_target(value: str) -> bool:
    """Só rota interna relativa (R4): a regra do `InternalRouteSchema` (começa com `/`,
    sem `//`, sem espaço nem `\\`, ≤ 300) e, a mais, nada de `:` no caminho (esquema
    embutido do tipo `/redirect:https:…`)."""
    return is_internal_route(value) and ":" not in value.split("?", 1)[0]


def _parse_next_step(raw: Any) -> NextStep | None:
    if not isinstance(raw, dict):
        return None
    label = _clean_str(raw.get("label"), max_chars=NEXT_STEP_LABEL_MAX_CHARS)
    if label is None:
        return None
    action: NextStepAction | None = None
    raw_action = raw.get("action")
    if isinstance(raw_action, dict):
        kind = raw_action.get("kind")
        value = raw_action.get("value")
        if kind == "navigate" and isinstance(value, str) and _safe_navigate_target(value):
            action = NextStepAction(kind="navigate", value=value)
        elif kind == "ask":
            ask = _clean_str(value, max_chars=300)
            if ask is not None:
                action = NextStepAction(kind="ask", value=ask)
    return NextStep(label=label, action=action)


def _parse_source(raw: Any) -> AnswerSource | None:
    if not isinstance(raw, dict):
        return None
    label = _clean_str(raw.get("label"), max_chars=SOURCE_LABEL_MAX_CHARS)
    as_of = raw.get("as_of")
    # `as_of` copiado da ferramenta; data inventada ou em outro formato derruba a fonte
    # (P6: horário de fonte que não é instante verificável não é fonte).
    if label is None or not isinstance(as_of, str) or not is_iso_datetime(as_of.strip()):
        return None
    as_of = as_of.strip()
    return AnswerSource(label=label, as_of=as_of)


def filter_data_refs(raw: Any, allowed: Iterable[str]) -> list[str]:
    """Só `result_id` vistos em `tool_call_completed` deste turno; sem duplicata."""
    allowed_set = set(allowed)
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for ref in raw:
        if isinstance(ref, str) and ref in allowed_set and ref not in out:
            out.append(ref)
        if len(out) >= DATA_REFS_MAX_ITEMS:
            break
    return out


def parse_answer_arguments(arguments: str | None) -> dict[str, Any] | None:
    """JSON dos args de `answer` → dict, ou `None` se ausente/malformado."""
    if not arguments:
        return None
    try:
        parsed = json.loads(arguments)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def blocks_from_answer_args(args: dict[str, Any], *, allowed_refs: Iterable[str]) -> AnswerBlocks:
    """Monta os blocos a partir dos args de `answer` (tolerante, item a item)."""
    verdict_raw = args.get("verdict")
    verdict = clamp_verdict(verdict_raw) if isinstance(verdict_raw, str) else ""

    why: list[str] = []
    raw_why = args.get("why")
    for item in raw_why if isinstance(raw_why, list) else []:
        line = _clean_str(item, max_chars=WHY_MAX_CHARS)
        if line is not None:
            why.append(line)
        if len(why) >= WHY_MAX_ITEMS:
            break

    sources: list[AnswerSource] = []
    raw_sources = args.get("sources")
    for item in raw_sources if isinstance(raw_sources, list) else []:
        src = _parse_source(item)
        if src is not None:
            sources.append(src)
        if len(sources) >= SOURCES_MAX_ITEMS:
            break

    next_steps: list[NextStep] = []
    raw_steps = args.get("next_steps")
    for item in raw_steps if isinstance(raw_steps, list) else []:
        step = _parse_next_step(item)
        if step is not None:
            next_steps.append(step)
        if len(next_steps) >= NEXT_STEPS_MAX_ITEMS:
            break

    return AnswerBlocks(
        verdict=verdict,
        why=why,
        data_refs=filter_data_refs(args.get("data_refs"), allowed_refs),
        sources=sources,
        next_steps=next_steps,
    )


# ---------------------------------------------------------------------------
# Fallback de formato (texto livre / teto)
# ---------------------------------------------------------------------------


def split_sentences(text: str) -> list[str]:
    """Quebra em frases por pontuação final seguida de espaço (ou fim).

    "R$ 1.200" e "3.5" não quebram: o ponto precisa de espaço depois.
    """
    flat = text.translate(_WS_TRANSLATION).strip()
    sentences: list[str] = []
    start = 0
    for i, ch in enumerate(flat):
        if ch in _SENTENCE_END and (i + 1 == len(flat) or flat[i + 1].isspace()):
            piece = flat[start : i + 1].strip()
            if piece:
                sentences.append(piece)
            start = i + 1
    tail = flat[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences


def fallback_blocks(text: str | None) -> AnswerBlocks:
    """Texto livre → `verdict` = primeira frase; as frases seguintes viram `why` (≤ 3)."""
    sentences = split_sentences(text or "")
    if not sentences:
        return AnswerBlocks(verdict=clamp_verdict(NO_ANSWER_VERDICT))
    why = [
        line
        for line in (_clean_str(s, max_chars=WHY_MAX_CHARS) for s in sentences[1:])
        if line is not None
    ][:WHY_MAX_ITEMS]
    return AnswerBlocks(verdict=clamp_verdict(sentences[0]), why=why)
