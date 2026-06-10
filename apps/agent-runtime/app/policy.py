"""Policy enforcement canônica do runtime LangGraph (defesa-em-profundidade).

> **Slot:** F2-S08 — `docs/AGENTS_LANGGRAPH.md` §8.

Fonte única de verdade para a reaplicação de policy DENTRO do runtime Python.
O Node (`runAgent.ts`, §8.1) já resolve e valida a policy antes de chamar o
`/run`; este módulo a reaplica defensivamente (deny-by-default, paranoia
intencional) para que NENHUMA tool fora da política chegue ao `call_model` e
NENHUM modelo fora da whitelist seja invocado — mesmo que o Node falhe ou seja
contornado.

Pure functions, **sem I/O**: recebem `PolicySnapshot` + dados já carregados e
devolvem o resultado. Isso mantém o módulo trivialmente testável e o torna a
costura única que `load_context` delega (zero divergência de comportamento).

Contrato de bloqueio de modelo (§8.2): **soft-block**. `model_block_reason`
devolve a string de motivo (ou `None`) em vez de levantar — assim o grafo segue
até `call_model`, que pula a chamada, e o `/run` emite o evento `model_blocked`
como faz hoje. `PolicyViolation` existe para caminhos de hard-fail explícitos
(quando o caller QUER abortar), mas o fluxo padrão do grafo permanece soft.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.types import PolicySnapshot, ToolDescriptor


class PolicyViolation(Exception):
    """Erro tipado para hard-fail de policy (quando o caller quer abortar).

    NÃO é levantado pelo fluxo soft-block padrão do grafo (`model_block_reason`
    + evento `model_blocked`). Existe para callers que precisem de uma falha
    explícita (ex.: validação fail-fast fora do loop do grafo).
    """


def filter_tools(
    tools: list[ToolDescriptor], snapshot: PolicySnapshot
) -> list[ToolDescriptor]:
    """Filtra as tools pela policy: categoria permitida + cap `max_tools_per_agent`.

    Reproduz `_apply_policy_to_tools` de `load_context.py` exatamente:

    - `allowed_tool_categories` vazio ⇒ SEM restrição de categoria (mantém o que
      o Node mandou). Não-vazio ⇒ só passam tools cuja `.category` está no set
      (categoria vazia no descriptor nunca passa ⇒ deny-by-default).
    - `max_tools_per_agent >= 0` ⇒ corta a lista nesse teto (preserva ordem).
      Valor negativo ⇒ sem cap (sentinela "ilimitado").
    """
    allowed_categories = set(snapshot.allowed_tool_categories)
    if allowed_categories:
        filtered = [t for t in tools if t.category in allowed_categories]
    else:
        filtered = list(tools)
    if snapshot.max_tools_per_agent >= 0:
        filtered = filtered[: snapshot.max_tools_per_agent]
    return filtered


def model_block_reason(model: str, snapshot: PolicySnapshot) -> str | None:
    """Motivo de bloqueio do modelo, ou `None` se permitido (soft-block §8.2).

    Reproduz a checagem inline de `load_context.py`: só bloqueia quando
    `allowed_models` é NÃO-vazio e `model` não está nele. `allowed_models` vazio
    significa "sem whitelist declarada" ⇒ nada é bloqueado. A mensagem casa
    palavra-por-palavra com a atual para preservar o texto do evento
    `model_blocked` no wire.
    """
    if snapshot.allowed_models and model not in snapshot.allowed_models:
        return f"model not allowed by workspace policy: {model}"
    return None


def effective_max_iterations(snapshot: PolicySnapshot, *, default: int) -> int:
    """Teto efetivo de iterações: clampa `default` ao `max_iterations` da policy.

    A policy é o teto duro — nunca permite MAIS iterações do que ela declara.
    `default` é o valor que o caller pediria na ausência de policy; o resultado
    é `min(default, snapshot.max_iterations)`, com piso 0 (nunca negativo).
    """
    return max(0, min(default, snapshot.max_iterations))


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    """Resultado de `apply_policy`: pronto para virar patch do node.

    `model_blocked_reason` é `None` quando o modelo é permitido. `tools` já está
    filtrado e capado. O node faz spread destes campos no seu patch de retorno.
    """

    tools: list[ToolDescriptor]
    model_blocked_reason: str | None


def apply_policy(
    tools: list[ToolDescriptor],
    model: str,
    snapshot: PolicySnapshot,
) -> PolicyDecision:
    """Conveniência: aplica a policy de uma vez (filtro de tools + block de modelo).

    Combina `filter_tools` e `model_block_reason` num único resultado que o
    `load_context` pode espalhar no patch sem reimplementar nada. Soft-block: NÃO
    levanta — o motivo (se houver) viaja em `PolicyDecision.model_blocked_reason`.
    """
    return PolicyDecision(
        tools=filter_tools(tools, snapshot),
        model_blocked_reason=model_block_reason(model, snapshot),
    )
