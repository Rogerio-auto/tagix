---
id: F30-S09
title: Auto-assign engine no inbound (round-robin/least-busy)
phase: F30
status: blocked
priority: high
estimated_size: M
depends_on: [F30-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/features/LIVECHAT.md
---

# F30-S09 — Auto-assign engine (inbound)

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §4; `LIVECHAT.md` §7.2
> **blocks:** —

## Objetivo

Distribuir conversas automaticamente no inbound: ao garantir uma conversa sem owner cujo time-alvo tenha `auto_assign_strategy ≠ manual`, escolher o atendente (round_robin/least_busy via `pickAutoAssignee` de S01), atribuir, gravar `routing_history (action='auto_assign')` e emitir `conversation:assigned`.

## Contexto

`teams.auto_assign_strategy` existe mas nunca foi consumido — não há engine. O ponto natural é a persistência do inbound (`inbound/db-ports.ts`), logo após o ensure da conversa. A escolha do candidato vem do repo `pickAutoAssignee` (S01) pra manter SQL no `@hm/db`.

## Escopo (faz)

- `apps/workers/src/inbound/db-ports.ts` (editar) — após ensure da conversa: se `assigned_to is null` e há `team_id`/`department_id` com estratégia automática, chamar `pickAutoAssignee`, setar `assigned_to`, inserir `routing_history`, emitir `conversation:assigned` via relay (padrão já existente no arquivo).
- `apps/workers/src/inbound/ports.ts` (editar, se preciso) — expor a porta do repo de auto-assign na injeção de deps.
- `apps/workers/src/inbound/inbound.test.ts` (editar) — conversa nova em time round_robin → atribui em rodízio; least_busy → menos ocupado; manual → não atribui; conversa já com owner → não mexe.

## Fora de escopo

- Visibilidade/enforcement (S07); settings (S08/S10).
- Reengajamento de IA (S06).
- UI de auto-assign (já existe `AutoAssignSection.tsx`; ajustes ficam em S10 se necessário).

## Arquivos permitidos

- `apps/workers/src/inbound/db-ports.ts`
- `apps/workers/src/inbound/ports.ts`
- `apps/workers/src/inbound/inbound.test.ts`

## Arquivos proibidos

- `apps/workers/src/inbound/{pipeline,parse,worker,index,status,instagram-inbound}.ts`; `apps/workers/src/agents/**` (S06); `packages/**` (repo vem de S01).

## Definition of Done

- [ ] round_robin e least_busy atribuem corretamente; manual não atribui.
- [ ] Conversa já atribuída não é re-atribuída (idempotente no reprocesso).
- [ ] `routing_history (auto_assign)` gravado + evento `conversation:assigned` emitido.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Especialista: **backend-engineer**. A atribuição entra na MESMA transação do ensure da conversa pra não emitir `message:new` antes de `conversation:assigned` de forma inconsistente.
- round_robin precisa de estado de rodízio — `pickAutoAssignee` (S01) resolve via menor carga/última atribuição; não inventar contador novo aqui.
