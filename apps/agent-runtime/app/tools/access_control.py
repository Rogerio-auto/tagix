"""Column-level access control para as tools "leves" de database.

> **Slot:** F2-S10 — `docs/AGENTS_LANGGRAPH.md` §6.5, `docs/DATA_MODEL.md` §7.5.

A RLS do Postgres isola **linhas** por workspace. Esta camada isola **colunas**:
qual tool pode ler/escrever quais campos de qual tabela. Mesmo consultando sob RLS,
um agente nunca deve conseguir exfiltrar colunas sensíveis (secrets, PII que a tool
não precisa, tokens cifrados). É a barreira de exfiltração — auditável isoladamente.

Princípios (inegociáveis):

  - **Deny-by-default.** Coluna que não está explicitamente no allowlist NÃO passa.
    Sem allowlist resolvível para `(tool, tabela)` → conjunto permitido vazio.
  - **`restricted_columns` tem precedência sobre `allowed_columns`.** Uma coluna
    listada em ambos é negada. Bloqueio explícito sempre vence.
  - **Pure, sem IO.** Consumido por F2-S06; nenhum acesso a banco/rede aqui.

Modelo de policy (espelha `tools.handler_config`, DATA_MODEL §7.5):

    {
      "table": "contacts",
      "allowed_columns": { "read": [...], "write": [...] },
      "restricted_columns": [...],   # precedência sobre allowed
      "required_columns": [...],     # obrigatórias em insert/update
    }

A config por-tool (resolvida do DB pelo Node + deep-merge de `agent_tools.overrides`)
é a fonte de verdade em runtime. Como defesa-em-profundidade, um *baseline* estático
de colunas sempre-negadas (`ALWAYS_DENIED`) é interseccionado por cima de qualquer
config: nenhuma policy mal-configurada consegue expor secrets/tokens.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, Final, Literal

from app.logging import get_logger

logger = get_logger()

Access = Literal["read", "write"]

__all__ = [
    "Access",
    "ColumnAccessError",
    "ColumnPolicy",
    "allowed_columns",
    "policy_from_config",
    "project",
    "ensure_required",
    "safe_columns",
    "ALWAYS_DENIED",
]


# ----------------------------------------------------------------------------
# Baseline estático de colunas SEMPRE negadas, por tabela.
#
# Defesa-em-profundidade: mesmo que a config por-tool (vinda do DB) liste uma
# dessas colunas por engano/maldade, ela é removida. São colunas que NENHUMA tool
# de agente tem motivo legítimo para ler — secrets cifrados, tokens, hashes,
# payloads brutos de webhook. Derivado de DATA_MODEL.md.
# ----------------------------------------------------------------------------

ALWAYS_DENIED: Final[Mapping[str, frozenset[str]]] = {
    "channels": frozenset(
        {"webhook_verify_token"},
    ),
    "channel_secrets": frozenset(
        {
            "access_token_enc",
            "refresh_token_enc",
            "app_secret_enc",
            "api_key_enc",
            "key_version",
        }
    ),
    "api_keys": frozenset({"key_hash", "key_prefix"}),
    "platform_secrets": frozenset(
        {"value_enc", "previous_value_enc", "key_version", "previous_key_version"}
    ),
    "agents": frozenset({"api_token_hash"}),
    "webhook_events": frozenset({"raw_payload"}),
    "ig_comments": frozenset({"raw_payload"}),
}

# Colunas negadas em QUALQUER tabela, por nome — heurística de fundo. Captura
# convenções de naming de segredos mesmo em tabelas não enumeradas acima.
_DENIED_SUFFIXES: Final[tuple[str, ...]] = (
    "_enc",
    "_hash",
    "_secret",
    "_token",
    "_password",
)
_DENIED_NAMES: Final[frozenset[str]] = frozenset(
    {"password", "secret", "token", "api_key", "access_token", "refresh_token"}
)


def _is_always_denied(table: str, column: str) -> bool:
    """True se a coluna é negada pelo baseline estático (por tabela ou por naming)."""
    if column in ALWAYS_DENIED.get(table, frozenset()):
        return True
    if column in _DENIED_NAMES:
        return True
    return column.endswith(_DENIED_SUFFIXES)


class ColumnAccessError(PermissionError):
    """Violação de policy de coluna (ex.: required column ausente do allowlist).

    Subclasse de `PermissionError` para o caller poder tratar como falha de
    autorização. Não vaza valores — só nomes de tabela/colunas.
    """

    def __init__(self, message: str, *, table: str, columns: Iterable[str]) -> None:
        self.table = table
        self.columns = sorted(set(columns))
        super().__init__(message)


class ColumnPolicy:
    """Policy imutável de colunas para um par `(tool, tabela)`.

    Construída a partir da `handler_config` da tool (`policy_from_config`) ou
    diretamente em testes. Deny-by-default: só passa o que está em `read`/`write`,
    menos o que está em `restricted` ou no baseline `ALWAYS_DENIED`.
    """

    __slots__ = ("table", "_read", "_write", "_restricted", "required")

    def __init__(
        self,
        *,
        table: str,
        read: Iterable[str] = (),
        write: Iterable[str] = (),
        restricted: Iterable[str] = (),
        required: Iterable[str] = (),
    ) -> None:
        if not table:
            raise ValueError("ColumnPolicy exige `table` não-vazio")
        self.table = table
        self._restricted: frozenset[str] = frozenset(restricted)
        # restricted + baseline estático têm precedência: subtraídos já na construção.
        self._read: frozenset[str] = self._sanitize(read)
        self._write: frozenset[str] = self._sanitize(write)
        self.required: frozenset[str] = frozenset(required)

    def _sanitize(self, columns: Iterable[str]) -> frozenset[str]:
        """Aplica precedência de bloqueio: remove restricted + always-denied."""
        return frozenset(
            c
            for c in columns
            if c
            and c not in self._restricted
            and not _is_always_denied(self.table, c)
        )

    def allowed(self, access: Access = "read") -> frozenset[str]:
        """Conjunto de colunas permitidas para o modo de acesso (deny-by-default)."""
        return self._write if access == "write" else self._read

    def is_allowed(self, column: str, access: Access = "read") -> bool:
        """True se `column` pode ser acessada no modo `access`."""
        return column in self.allowed(access)


def _as_str_set(value: Any) -> list[str]:
    """Coage um valor de config (esperado list[str]) para list[str], defensivo.

    Config vem de JSONB do Postgres; um valor torto (None, dict, ints) não deve
    derrubar o runtime nem — pior — abrir acesso. Itens não-string são descartados.
    """
    if value is None:
        return []
    if isinstance(value, str):
        # Uma string solta NÃO é uma lista de colunas; recusa (deny-by-default).
        return []
    if isinstance(value, Mapping):
        return []
    if isinstance(value, Iterable):
        return [item for item in value if isinstance(item, str) and item]
    return []


def policy_from_config(
    config: Mapping[str, Any] | None, *, table: str | None = None
) -> ColumnPolicy:
    """Constrói uma `ColumnPolicy` a partir da `handler_config` de uma tool.

    `config` é o `tools.handler_config` (já com `agent_tools.overrides` deep-merged
    pelo runtime). Shape esperado (DATA_MODEL §7.5):

        {
          "table": "contacts",
          "allowed_columns": {"read": [...], "write": [...]},
          "restricted_columns": [...],
          "required_columns": [...],
        }

    `table` override prevalece sobre `config["table"]` (útil quando o caller já
    resolveu a tabela). Config ausente/torta → policy vazia (deny-all), nunca erro.
    """
    cfg: Mapping[str, Any] = config or {}
    resolved_table = table or (cfg.get("table") if isinstance(cfg.get("table"), str) else None)
    if not resolved_table:
        raise ColumnAccessError(
            "handler_config sem `table` resolvível — impossível aplicar ACL de coluna",
            table="<unknown>",
            columns=(),
        )

    allowed_raw = cfg.get("allowed_columns")
    allowed_map: Mapping[str, Any] = allowed_raw if isinstance(allowed_raw, Mapping) else {}

    return ColumnPolicy(
        table=resolved_table,
        read=_as_str_set(allowed_map.get("read")),
        write=_as_str_set(allowed_map.get("write")),
        restricted=_as_str_set(cfg.get("restricted_columns")),
        required=_as_str_set(cfg.get("required_columns")),
    )


def allowed_columns(
    config: Mapping[str, Any] | None,
    *,
    table: str | None = None,
    access: Access = "read",
) -> frozenset[str]:
    """Conjunto de colunas permitidas para `(config da tool, tabela, modo)`.

    API fina sobre `policy_from_config(...).allowed(access)`. Deny-by-default:
    qualquer coluna fora do retorno NÃO deve ser lida/escrita.
    """
    return policy_from_config(config, table=table).allowed(access)


def safe_columns(
    requested: Iterable[str],
    policy: ColumnPolicy,
    *,
    access: Access = "read",
    log_context: Mapping[str, str] | None = None,
) -> list[str]:
    """Filtra `requested` para apenas as colunas permitidas pela `policy`.

    Preserva a ordem do request e remove duplicatas. Colunas negadas são logadas
    (apenas nomes — nunca valores) para auditoria de tentativas de exfiltração.
    Usado para construir a lista de colunas de um `SELECT`/`UPDATE` seguro.
    """
    permitted = policy.allowed(access)
    safe: list[str] = []
    denied: list[str] = []
    seen: set[str] = set()
    for column in requested:
        if column in seen:
            continue
        seen.add(column)
        if column in permitted:
            safe.append(column)
        else:
            denied.append(column)

    if denied:
        ctx = dict(log_context or {})
        logger.warning(
            "column-acl: {n} coluna(s) negada(s) em {table}.{access}: {denied}",
            n=len(denied),
            table=policy.table,
            access=access,
            denied=",".join(sorted(denied)),
            **ctx,
        )
    return safe


def project(
    row: Mapping[str, Any] | None,
    policy: ColumnPolicy,
    *,
    access: Access = "read",
    log_context: Mapping[str, str] | None = None,
) -> dict[str, Any] | None:
    """Projeta `row` para apenas as colunas permitidas (filtra exfiltração).

    Última barreira: mesmo que um SELECT tenha retornado colunas a mais (ex.: bug,
    `SELECT *`, join), `project` garante que só campos permitidos chegam ao modelo.
    `None` (row inexistente) passa como `None`. Chaves negadas são logadas por nome.
    """
    if row is None:
        return None

    permitted = policy.allowed(access)
    projected: dict[str, Any] = {}
    dropped: list[str] = []
    for key, value in row.items():
        if key in permitted:
            projected[key] = value
        else:
            dropped.append(key)

    if dropped:
        ctx = dict(log_context or {})
        logger.warning(
            "column-acl: project removeu {n} coluna(s) não-permitida(s) de {table}: {dropped}",
            n=len(dropped),
            table=policy.table,
            dropped=",".join(sorted(dropped)),
            **ctx,
        )
    return projected


def ensure_required(
    provided: Iterable[str],
    policy: ColumnPolicy,
    *,
    access: Access = "write",
) -> None:
    """Valida que todas as `required_columns` da policy estão presentes em `provided`.

    Para insert/update: a tool precisa fornecer todas as colunas obrigatórias, e
    cada uma precisa ser escrevível (estar no allowlist de `write`). Levanta
    `ColumnAccessError` se faltar obrigatória ou se uma obrigatória não for
    escrevível (config incoerente — fail-closed, nunca silencioso).
    """
    provided_set = set(provided)
    writable = policy.allowed(access)

    missing = policy.required - provided_set
    if missing:
        raise ColumnAccessError(
            f"colunas obrigatórias ausentes em {policy.table}",
            table=policy.table,
            columns=missing,
        )

    not_writable = policy.required - writable
    if not_writable:
        raise ColumnAccessError(
            f"colunas obrigatórias não estão no allowlist de escrita de {policy.table} "
            "(config incoerente)",
            table=policy.table,
            columns=not_writable,
        )
