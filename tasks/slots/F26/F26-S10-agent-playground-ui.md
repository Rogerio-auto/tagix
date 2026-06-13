---
id: F26-S10
title: Agent Playground UI — chat de teste + trace de execução + seletor de modelo/params
phase: F26
status: review
priority: medium
estimated_size: L
depends_on: [F26-S06]
agent_id: frontend-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
  - docs/PRD.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-13T15:15:18Z
completed_at: 2026-06-13T15:18:27Z

---
# F26-S10 — Agent Playground UI

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §7; PRD §80; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Playground de teste isolado de agentes no painel (PRD §80, super-admin v1): escolher um agente de um tenant, conversar em **sandbox** (zero side-effect — F26-S06), **trocar modelo on-the-fly** dentro da `allowed_models` da policy, override efêmero de system prompt/params, e um **painel de trace** (tokens, tool calls + resultados marcados "would-do", custo estimado, latência por nó). Stream SSE do `/run` em modo sandbox.

## Contexto

O runtime sandbox vem do F26-S06 (`mode:'sandbox'`, custo `is_test`, tools mockadas). A chamada passa pelo proxy interno autenticado (AGENT_RUNTIME_TOKEN) — se precisar de uma rota API de playground, é glue do orchestrator. Shell/lib do F25-S06.

## Escopo (faz)

- `apps/web/app/(platform)/platform/playground/**` + `apps/web/features/platform-admin/playground/**`: seletor de tenant+agente, chat de teste (stream SSE), seletor de modelo (limitado à whitelist/policy), inputs de override (prompt/temperatura/tools), painel de trace (tool calls + would-do + custo is_test + latência por nó).

## Fora de escopo

- Runtime sandbox (F26-S06). Exposição ao cliente no app de workspace (follow-up). Shell/lib (F25-S06).

## Arquivos permitidos

- `apps/web/app/(platform)/platform/playground/**`
- `apps/web/features/platform-admin/playground/**`

## Arquivos proibidos

- `apps/web/features/platform-admin/{shell,lib,tenants,plans,subscriptions,impersonation}/**`

## Definition of Done

- [ ] Conversa de teste em sandbox via stream SSE; troca de modelo restrita à whitelist/policy do workspace; override efêmero de prompt/params; trace com tool calls (would-do)+custo(is_test)+latência.
- [ ] Deixa explícito que é SANDBOX (nada sai pro cliente); DS v2 dark-first (zero hex).
- [ ] `pnpm --filter @hm/web typecheck` + lint + `build` verdes.

## UX considerations

- **§3.9** (timeline) p/ o trace de execução; **§3.6** skeleton/streaming sem tela branca.
- Indicação forte de "modo teste / sandbox" (não confundir com conversa real).
- **§2.5** help inline `?` explicando o que sandbox mocka, não tooltip.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Reusa lib do F25 + o padrão de streaming SSE já existente no web (conversas/agentes). Paraleliza com F26-S08/S09. Link na nav = glue do orchestrator.
