"""Prompt do LLM-judge (F29-S02).

Monta as mensagens (system + user) para a avaliacao pos-conversa. O system trava
o vocabulario de objecao e o formato de saida (JSON estrito); o user carrega o
transcript ja redigido em linhas `papel: texto`. Determinismo: temperature baixa +
response_format json_object no provider (ver judge.py).
"""

from __future__ import annotations

from dataclasses import dataclass

_SYSTEM_PROMPT = """You are a strict, impartial conversation-quality auditor for a \
customer-support / sales platform. You receive the full transcript of a CLOSED \
conversation between a CONTACT (the customer) and the BUSINESS side (a human agent \
and/or an AI agent). Evaluate ONLY what is in the transcript.

Return a SINGLE JSON object, no prose, with EXACTLY these fields:
- "quality_score": integer 0-100. How good was the BUSINESS-side handling \
(clarity, correctness, tone, resolution).
- "quality_rationale": short string (1-2 sentences) justifying the score.
- "sentiment_score": integer -100..100 measuring the CONTACT's sentiment across \
the dialogue, or null if the contact said too little to judge.
- "csat_label": one of "promoter", "neutral", "detractor", or null (null when \
sentiment is null).
- "handled_by": one of "ai", "human", "mixed" — who conducted the conversation \
majority of the time (use the role hints in the transcript).
- "objections": array (possibly empty) of objects raised BY THE CONTACT, each with:
    - "category": one of "price", "timing", "trust", "competitor", \
"feature_gap", "authority", "other".
    - "label": short human-readable label.
    - "excerpt": a SHORT verbatim quote from the contact (max ~1 sentence), or null.
    - "resolved": boolean — was the objection addressed/overcome in the conversation.

Rules: output VALID JSON only. Do not invent objections that are not in the \
transcript. Keep excerpts short (no full transcript). If the conversation is \
empty or has no contact content, still return quality_score with sentiment_score \
and csat_label as null and objections as [].
"""


@dataclass(frozen=True)
class TranscriptLine:
    """Uma linha do transcript ja normalizada para o prompt."""

    role: str  # contact | human | ai | system
    content: str


def render_transcript(lines: list[TranscriptLine]) -> str:
    """Renderiza o transcript em texto `role: content` (uma linha por mensagem)."""
    if not lines:
        return "(empty conversation — no messages)"
    return "\n".join(f"{ln.role}: {ln.content}" for ln in lines if ln.content)


def build_messages(transcript: str) -> list[dict[str, str]]:
    """Monta as mensagens OpenAI-style para o judge."""
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Evaluate the following conversation transcript and return the JSON "
                "object as specified.\n\n--- TRANSCRIPT START ---\n"
                f"{transcript}\n--- TRANSCRIPT END ---"
            ),
        },
    ]
