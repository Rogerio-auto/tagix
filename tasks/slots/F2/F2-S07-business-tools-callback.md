---
id: F2-S07
title: Tools de negócio via callback HTTP para o Node (internal tools endpoint)
phase: F2
status: done
priority: high
estimated_size: M
depends_on: [F2-S06, F2-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:52:19Z
completed_at: 2026-06-10T03:52:19Z

---
# F2-S07 — Tools de negócio (callback Python → Node)

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §6.3, §7.4; `docs/ROADMAP.md` F2-S07
> **blocks:** F2-S20

## Objetivo
Mecanismo de tools "de negócio": o runtime Python chama de volta o Node (`POST api:3001/internal/tools/{toolKey}`) com token interno compartilhado, e o Node executa a ação no domínio (RLS) registrando `tool_logs`. Cobre o transporte + o endpoint Node; as tools concretas modulares ficam em F2-S20.

## Escopo (faz)
- `app/tools/callback.py`: `CallbackTool` (subclasse de `Tool`) que serializa args e faz `httpx.post` ao Node com `INTERNAL_TOOL_TOKEN`, normaliza resposta/erro.
- `apps/api/src/internal/tools/**`: router `POST /internal/tools/:toolKey` (auth por token interno, NÃO sessão de usuário), dispatch por toolKey, validação Zod por tool, escrita de `tool_logs` (RLS via workspace do payload), retorno tipado.

## Fora de escopo
- As tools workflow concretas (transfer_to_human, mark_resolved, register_conversion…) — F2-S20. Tools leves — F2-S06.

## Arquivos permitidos
- `apps/agent-runtime/app/tools/callback.py`
- `apps/api/src/internal/tools/**`

## Definition of Done
- [ ] `CallbackTool` chama o Node e trata sucesso/erro/timeout.
- [ ] Endpoint Node autentica por token interno (rejeita sem/!=), valida args (Zod), grava `tool_logs`, é idempotente onde aplicável.
- [ ] `ruff`/`pytest` (Python) + `pnpm --filter @hm/api typecheck`/lint verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
uv run --directory apps/agent-runtime ruff check .
```

## Notas
Token interno é segredo só em `.env` (nunca commit). O endpoint interno é separado das rotas autenticadas por sessão — não montar atrás de `requireAuth`.
