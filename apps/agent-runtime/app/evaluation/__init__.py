"""LLM-judge de avaliacao pos-conversa (F29-S02)."""

from app.evaluation.judge import (
    EvaluationOutcome,
    JudgeError,
    JudgeInvalidOutputError,
    evaluate_conversation,
)
from app.evaluation.schema import JudgeObjection, JudgeResult

__all__ = [
    "EvaluationOutcome",
    "JudgeError",
    "JudgeInvalidOutputError",
    "JudgeObjection",
    "JudgeResult",
    "evaluate_conversation",
]
