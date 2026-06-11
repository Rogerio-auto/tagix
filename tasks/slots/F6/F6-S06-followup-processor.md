---
id: F6-S06
title: Followup processor — scheduled_followups persistente + tick (não setTimeout)
phase: F6
status: in-progress
priority: medium
estimated_size: M
depends_on: [F6-S01, F6-S05]
agent_id: backend-engineer
claimed_at: 2026-06-11T05:20:19Z

---
# F6-S06 — Followup processor

> **source_docs:** `docs/features/CAMPAIGNS.md` §8.4, §14; `docs/ROADMAP.md` F6-S03
> **blocks:** —

## Objetivo
Processar followups de campanha de forma durável: ao receber o evento de followup (`on_reply`/`on_no_reply`/etc), resolve o `campaign_followups` aplicável e agenda em `scheduled_followups` (persistente); um tick drena os vencidos e publica o envio. Substitui o `setTimeout` do v1 — sobrevive a crash.

## Escopo (faz)
- `apps/workers/src/campaigns/followups.ts`: consumer de `campaign.followup` → `schedulePersistedFollowup` (insere em `scheduled_followups`); tick que busca `scheduled_at <= now`, dispara o envio (via dispatch de delivery / outbound) e marca processado, com retry.
- Registro no bootstrap/scheduler (gap-fill orchestrator).

## Fora de escopo
- Disparo do evento `on_reply` (F6-S07, hook do inbound), schema (F6-S01), tick principal (F6-S05).

## Arquivos permitidos
- `apps/workers/src/campaigns/followups.ts`

## Definition of Done
- [ ] Evento de followup agenda em `scheduled_followups`; tick processa vencidos (latência scheduled→sent < 30s, §14) com retry; idempotente.
- [ ] `pnpm --filter @hm/workers test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Mesma família do worker-campaigns (F6-S05) — arquivo separado dentro de `campaigns/` p/ não colidir. Persistência > setTimeout é requisito explícito (§8.4).
