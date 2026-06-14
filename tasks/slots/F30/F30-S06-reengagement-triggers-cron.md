---
id: F30-S06
title: Gatilhos de reengajamento da IA — cron (ocioso/fora-horário)
phase: F30
status: done
priority: medium
estimated_size: M
depends_on: [F30-S01, F30-S04, F30-S05]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
claimed_at: 2026-06-14T17:27:15Z
completed_at: 2026-06-14T17:37:56Z

---
# F30-S06 — Reengajamento da IA por gatilho (cron)

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §2
> **blocks:** —

## Objetivo

Cron idempotente que reengaja a IA com contexto em conversas elegíveis: **ociosas** (sem atividade humana há N minutos, default 60) e **fora do horário comercial**. Ao disparar, retoma `ai_mode` e enfileira o run do agente (que já usa o contexto consciente de S05).

## Contexto

Espelha o padrão de `agents/followup.ts` (F2-S21) e dos schedulers existentes (`*/scheduler.ts`). Usa `ai_last_human_at` (S04) e o horário comercial do workspace (F8 — `business hours`).

## Escopo (faz)

- `apps/workers/src/agents/reengagement.ts` (novo) — tick periódico: busca conversas `ai_mode='paused'` com `ai_paused_reason='human_takeover'` cujo `ai_last_human_at` excede a janela ociosa, OU mensagens pendentes fora do horário comercial; marca elegíveis, retoma `ai_mode='on'`, registra motivo, e enfileira o run do agente. Idempotente (lock/flag, sem re-disparo).
- `apps/workers/src/agents/reengagement.test.ts` (novo).
- `apps/workers/src/agents/index.ts` (editar) — registrar o tick no bootstrap dos workers de agente.

## Fora de escopo

- Rotulagem/diretriz de contexto (S05).
- Auto-pausa no envio (S04).
- Configuração da janela ociosa na UI (cai em S10 settings, se entrar; aqui usa default + leitura de config se já existir).

## Arquivos permitidos

- `apps/workers/src/agents/reengagement.ts`
- `apps/workers/src/agents/reengagement.test.ts`
- `apps/workers/src/agents/index.ts`

## Arquivos proibidos

- `apps/workers/src/agents/{run,worker,buffer,followup,metrics}.ts`; `apps/workers/src/inbound/**` (S09); `apps/workers/src/bootstrap/**`.

## Definition of Done

- [ ] Gatilho ocioso e fora-de-horário disparam reengajamento com retomada de `ai_mode`.
- [ ] Idempotente — não dispara duas vezes pra mesma janela.
- [ ] Enfileira run do agente (reusa o caminho existente de execução).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Especialista: **backend-engineer**. Janela ociosa default 60min; ler de config do workspace se existir, senão constante. Horário comercial vem das tabelas da F8 (`sla`/business hours) — reutilizar helper se houver, senão query simples.
- Não duplicar com o auto-follow-up da F2-S21 (intenção diferente: aquele é follow-up de venda; este é retomada pós-handoff). Coexistem.
