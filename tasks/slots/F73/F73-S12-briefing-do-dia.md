---
id: F73-S12
title: Briefing do dia (geração determinística com score explicável por receita em risco, dado com hora, revalidação e push da manhã)
phase: F73
status: done
priority: high
estimated_size: M
model: sonnet
ui: false
depends_on: [F73-S01, F73-S02, F73-S03, F73-S05]
blocks: [F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/features/APP_MOBILE_PLAN.md
  - docs/features/DASHBOARD.md
agent_id: backend-engineer
claimed_at: 2026-10-17T07:27:45Z
completed_at: 2026-10-17T07:30:04Z

---
# F73-S12 — Briefing do dia

## Objetivo

Na primeira abertura do dia, cada membro recebe no máximo 3 itens que pedem ação hoje, em ordem de **receita em risco**. Cada item traz o número, o motivo e a ação de um clique. Dado velho não aparece como fato, e item resolvido desde a geração sai. Quem optou recebe um push de manhã ("Briefing do dia: 3 itens").

## Contexto

A2 da maquete; regras na spec §7.1. A Home "Hoje" (`routes/dashboard/today.ts`) já calcula a fila de leads esperando com a régua de urgência certa: reutilize por import. **Nada de LLM aqui na v1**: o texto vem de modelo de texto determinístico (spec §10), o que dá custo zero, nenhuma superfície de injeção e o mesmo resultado em teste.

## Escopo (faz)

- `apps/api/src/services/copilot/briefing/**`:
  - `candidates.ts`: os 5 tipos da spec §7.1 (`deals_idle`, `leads_waiting`, `events_today`, `autopilot_pending`, `campaign_issue`), cada um sob o escopo do membro (`services/copilot/identity/scope.ts`, F73-S03).
    - `deals_idle` usa `dealIdleDaysSql()` de `@hm/db` e agrupa por estágio.
    - `leads_waiting` reaproveita a consulta de `routes/dashboard/today.ts` (por import; se precisar extrair, crie a função aqui sem editar `today.ts`).
    - `autopilot_pending` lê `copilot_suggestions` pendentes de estágios em `daily_approval`; retorna vazio enquanto a F73-S13 não existir.
  - `score.ts`: `scoreItem(candidate, now)` = valor em risco × peso, com tabela `BRIEFING_WEIGHTS` versionada (`BRIEFING_SCORE_VERSION`) e um `why[]` com os números que compõem o score. Função pura com teste por tabela.
  - `compose.ts`: escolhe os 3 maiores (desempate pelo mais antigo), `overflow_count` com o resto e a `action` de cada item:
    - `{ kind: 'ask', value: 'Mover parados há 7 dias para Reativação' }` (abre o Copiloto com o pedido pronto), ou
    - `{ kind: 'navigate', value: '/pipeline?stage=…' }`.
    O texto vem de modelos pt-BR com `Intl` e o locale e fuso do workspace, por exemplo "4 negócios sem resposta há 3 dias · R$ 31.400 em Orçamento enviado".
  - `freshness.ts`: cada item guarda `as_of` e `source`. `revalidate(briefing)` reconfere cada item ao abrir quando a geração tem mais de 60 min: registro mudou de estado → item `resolved` (sai da lista e conta como "1 já resolvido"); fonte mais velha que o limite → item fora e `status='stale'` se não sobrar nenhum. `integration_alert` é seam para a F75: `registerBriefingSource(provider)`.
  - `generate.ts`: `getOrCreateToday(principal)`. Idempotente por (membro, data local do workspace); gera na hora se não existe. Mira p95 ≤ 300 ms com os índices atuais; se não der, registrar `EXPLAIN` e o índice que falta na nota (sem criar).
  - `scheduler.ts`: às 06:30 locais de cada workspace, para membros com `auto_open ≠ 'never'` e ativos nos últimos 14 dias:
    - gera o briefing;
    - se o membro optou por push de `copilot_briefing` e há itens, chama `notifyEvent` (só push; regra do S02) com "Briefing do dia: N itens";
    - emite `copilot:briefing_ready`.
    Lock Redis por workspace e janela; processa em lotes de 50 membros; nunca dois envios no mesmo dia (`push_sent_at`).
- Início do scheduler em `apps/api/src/server.ts`, junto ao sweeper do S05 (mesmo padrão: `unref`, parada no shutdown).
- Rotas `apps/api/src/routes/copilot/briefing/**`: `GET /api/copilot/briefing/today` (gera ou revalida e devolve `BriefingSchema`) e `POST /api/copilot/briefing/today/seen` (grava `seen_at` e `copilot_member_prefs.briefing_last_seen_on`; é o que a interface usa para "uma vez por dia").

## Fora de escopo

- Interface e abertura automática (F74-S05). Narração por LLM (v1.1). Alertas de integração (F75, pelo seam).

### files_allowed

- `apps/api/src/services/copilot/briefing/**`
- `apps/api/src/routes/copilot/briefing/**`
- `apps/api/src/server.ts`

### files_forbidden

- `apps/api/src/routes/dashboard/**` (só importar)
- `packages/**`

## Definition of Done

- [ ] `score.ts` com teste por tabela; o `why[]` reproduz os números do score
- [ ] `compose`: ≤ 3 itens, `overflow_count` certo, desempate estável, texto com locale do workspace (teste com `pt-BR` e `en-US`)
- [ ] Escopo: AGENT recebe só negócios e conversas dele (teste com dois agentes)
- [ ] Revalidação: negócio movido depois da geração sai como resolvido; fonte velha não vira fato (testes com relógio fixo)
- [ ] Scheduler: 1 push por dia por membro no máximo; respeita opt-in; lock evita duplicidade com duas instâncias (teste com dois ticks simultâneos)
- [ ] `GET /today` p95 medido e registrado na nota

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/copilot/briefing src/routes/copilot/briefing --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- "Briefing longo é lista de tarefas, não briefing": 3 é teto de produto, não parâmetro.
- O horário 06:30 e o limite de 60 min são constantes nomeadas para calibrar depois por telemetria (S15).
