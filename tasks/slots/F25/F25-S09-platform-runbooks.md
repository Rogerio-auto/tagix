---
id: F25-S09
title: Runbooks de plataforma — rotate-openrouter-key + manage-workspace-agent-policy
phase: F25
status: done
priority: low
estimated_size: S
depends_on: []
agent_id: general-purpose
source_docs:
  - docs/ROADMAP.md#F2.5
  - docs/INFRASTRUCTURE.md
claimed_at: 2026-06-13T01:16:36Z
completed_at: 2026-06-13T01:16:45Z

---
# F25-S09 — Runbooks de plataforma

> **source_docs:** `docs/ROADMAP.md` F2.5-S06; `docs/INFRASTRUCTURE.md`
> **blocks:** —

## Objetivo

Dois runbooks operacionais para o super-admin: rotação da chave OpenRouter (impacto, passos, verificação, rollback) e gestão da policy de agentes por workspace (o que cada cap/flag faz, como aplicar com segurança, pegadinhas de custo).

## Contexto

A F2.5 entrega o painel; estes runbooks são o playbook de operação. Produção é Linux (bash). Complementam o `rotate-encryption-key.md` (F10, chave-mestra) — este é a key OpenRouter individual.

## Escopo (faz)

- `docs/runbooks/rotate-openrouter-key.md` (novo): quando/por que rotacionar a key OpenRouter, passos no painel (F25-S08) **ou** via DB/env, verificação (agente responde, llm_usage_logs registra), rollback, e o blast radius (todos os workspaces usam a mesma key de plataforma).
- `docs/runbooks/manage-workspace-agent-policy.md` (novo): glossário de cada campo de `workspace_agent_policies` (allowed_models, flags LangGraph, caps), como aumentar/reduzir com segurança, efeito no enforcement em runtime, e armadilhas de custo (max_monthly_cost_usd, max_tokens_per_call).

## Fora de escopo

- Código (painel é S06-S08). Rotação da chave-mestra (F10).

## Arquivos permitidos

- `docs/runbooks/rotate-openrouter-key.md`
- `docs/runbooks/manage-workspace-agent-policy.md`

## Arquivos proibidos

- Código de produção; outros runbooks existentes.

## Definition of Done

- [ ] Os 2 runbooks com passos acionáveis (bash p/ prod quando aplicável), critério de "resolvido" e rollback; coerentes com o schema/painel real da F2.5.
- [ ] Sem comando destrutivo sem confirmação/backup explícito.

## Validação

```bash
test -f docs/runbooks/rotate-openrouter-key.md
test -f docs/runbooks/manage-workspace-agent-policy.md
```

## Notas

- Executor: **general-purpose** (docs). Independente — pode rodar desde o início, em paralelo com F25-S01/S06.
