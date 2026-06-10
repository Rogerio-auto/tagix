"""Tool `register_conversion` — registra uma conversão atribuída ao agente (§7.4).

Tool de workflow (callback Node) com uma camada extra de policy *defense-in-depth*
em Python. A regra de negócio é autoritativa no Node, que revalida tudo; mas como
conversões envolvem dinheiro/atribuição, fazemos um curto-circuito local barato
quando a política do workspace claramente proíbe o agente de registrar conversões
— evitando até o callback nesse caso.

## Policy (defense-in-depth, Node revalida)

`workspace_agent_policies.allow_agent_conversions` e
`agent_conversion_require_approval` não viajam no `ToolContext` nem no
`PolicySnapshot` (que não os modela). Quando o Node resolve a config efetiva da
tool, ele pode injetá-los no `handler_config` desta tool (chaves
`allow_agent_conversions` / `agent_conversion_require_approval`). Lemos dali:

  - `allow_agent_conversions is False` → bloqueia ANTES do callback (sem efeito
    colateral, sem custo de rede). Mensagem estável para o modelo.
  - ausente/`True` → segue para o callback; o Node é a fonte de verdade e
    revalida (e aplica `require_approval`, enfileirando se preciso).

Como o `handler_config` é *seed* até o Node injetar o efetivo, o default é
**permitir** (fail-open no cliente, fail-closed no Node) — nunca bloqueamos por
falta de informação; só quando a flag diz explicitamente `False`.

## Estado de integração (F5)

O schema de conversões (`conversion_events` / tipos de conversão) é entregue em
F5-S13. Até lá, o Node responde **"não suportado ainda"** a este `toolKey`: o
callback acontece normalmente e a resposta do Node (ok=False, mensagem estável)
é repassada ao modelo. Quando F5 existir, o mesmo `toolKey` passa a gravar de
fato — sem mudança nesta tool.

## Contrato Node (`POST /internal/tools/register_conversion`)

  - envelope `args`: `{ type_key: str, value_cents: int | None,
    currency: str | None, note: str | None }`
  - mutação (a partir de F5-S13): insere em `conversion_events`
    (`workspace_id`, `conversation_id`, `contact_id`, `agent_id`, `type_key`,
    `value_cents`, `currency`, `note`, `source = 'agent'`), respeitando
    `workspace_agent_policies.allow_agent_conversions` (rejeita se off) e
    `agent_conversion_require_approval` (insere com `status = 'pending_approval'`
    em vez de `confirmed`). Grava `tool_logs`.
  - resposta: `{ ok, content, payload?: { conversion_id?, status?, pending_approval? } }`.
    Antes de F5: `{ ok: false, error: "Conversões ainda não suportadas." }`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.base import ToolContext, ToolResult
from app.tools.callback import CallbackTool


class RegisterConversionArgs(BaseModel):
    """Argumentos para registrar uma conversão."""

    type_key: str = Field(
        description=(
            "Chave do tipo de conversão configurado no workspace (ex.: 'sale', "
            "'appointment_booked', 'lead_qualified'). Use exatamente uma das "
            "chaves disponíveis no contexto."
        ),
        min_length=1,
        max_length=120,
    )
    value_cents: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Valor monetário da conversão em centavos (ex.: R$ 150,00 → 15000). "
            "Obrigatório para tipos de conversão que envolvem dinheiro; omitir "
            "para eventos puros (ex.: agendamento)."
        ),
    )
    currency: str | None = Field(
        default=None,
        min_length=3,
        max_length=3,
        description=(
            "Código ISO-4217 da moeda (ex.: 'BRL', 'USD'). Necessário se "
            "'value_cents' for informado."
        ),
    )
    note: str | None = Field(
        default=None,
        max_length=500,
        description="Observação opcional sobre a conversão (contexto para a equipe).",
    )


class RegisterConversionTool(CallbackTool):
    key = "register_conversion"
    name = "Registrar conversão"
    description = (
        "Registra uma conversão atribuída a este atendimento (venda, agendamento, "
        "lead qualificado etc.). Use somente quando a conversão de fato ocorreu na "
        "conversa. Para conversões com valor monetário, informe 'value_cents' e "
        "'currency'. O registro pode exigir aprovação humana ou estar desabilitado, "
        "conforme a configuração do workspace."
    )
    category = "workflow"
    Args = RegisterConversionArgs

    # ----------------------------------------------------------------- policy
    def _conversions_allowed(self) -> bool:
        """Defense-in-depth: só bloqueia se a flag injetada disser `False`.

        Fail-open no cliente (default permitir); o Node é autoritativo e revalida
        `allow_agent_conversions`. Ler do `handler_config` (config efetiva
        resolvida pelo Node) mantém esta tool sem acoplamento ao shape de policy.
        """
        flag = self.handler_config.get("allow_agent_conversions", True)
        return bool(flag)

    async def _run(
        self, args: RegisterConversionArgs, ctx: ToolContext
    ) -> ToolResult:
        # Curto-circuito de policy ANTES do callback (sem efeito colateral).
        # Playground é tratado pela base, mas o bloqueio de policy vem primeiro:
        # mesmo simulando, não anunciamos um caminho que a policy proíbe.
        if not self._conversions_allowed():
            return ToolResult(
                ok=False,
                error=(
                    "Registro de conversões pelo agente está desabilitado para "
                    "este workspace."
                ),
            )
        # Política permite (ou indefinida) → delega ao callback Node, que revalida
        # e aplica require_approval. A base trata playground / transporte / erro.
        return await super()._run(args, ctx)
