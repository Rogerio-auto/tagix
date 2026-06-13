"""Schema Pydantic da saida do LLM-judge (F29-S02).

Contrato de docs/features/AGENT_QUALITY_OBJECTIONS.md SS2. A saida do modelo e
validada contra `JudgeResult`: saida invalida levanta erro e a avaliacao NUNCA vira
retorno parcial (o worker F29-S03 nao persiste lixo, tenta no proximo tick).

Os literais (categoria de objecao, csat_label, handled_by) espelham os CHECKs das
tabelas conversation_evaluations / objections (F29-S01) — fonte unica de verdade.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ObjectionCategory = Literal[
    "price",
    "timing",
    "trust",
    "competitor",
    "feature_gap",
    "authority",
    "other",
]
CsatLabel = Literal["promoter", "neutral", "detractor"]
HandledBy = Literal["ai", "human", "mixed"]


class JudgeObjection(BaseModel):
    """Uma objecao classificada pelo judge."""

    model_config = ConfigDict(extra="ignore")

    category: ObjectionCategory
    label: str = Field(min_length=1, max_length=200)
    # Excerto curto do contato (PII curta — nunca o transcript inteiro, SS2.4).
    excerpt: str | None = Field(default=None, max_length=500)
    resolved: bool = False


class JudgeResult(BaseModel):
    """Resultado estruturado e validado do LLM-judge para uma conversa.

    `quality_score` 0..100 e obrigatorio; `sentiment_score` -100..100 e opcional
    (conversa sem conteudo do contato -> None, nao polui a media de CSAT).
    """

    model_config = ConfigDict(extra="ignore")

    quality_score: int = Field(ge=0, le=100)
    quality_rationale: str | None = Field(default=None, max_length=600)
    sentiment_score: int | None = Field(default=None, ge=-100, le=100)
    csat_label: CsatLabel | None = None
    handled_by: HandledBy
    objections: list[JudgeObjection] = Field(default_factory=list)
