---
id: F7-S05
title: Event reminders cron — scheduler 5min + notification + outbound WhatsApp opcional
phase: F7
status: done
priority: medium
estimated_size: M
depends_on: [F7-S01, F7-S03]
agent_id: backend-engineer
claimed_at: 2026-06-11T17:19:18Z
completed_at: 2026-06-11T17:23:09Z

---
# F7-S05 — Event reminders

> **source_docs:** `docs/features/CALENDAR.md` §6; `docs/ROADMAP.md` F7-S07
> **blocks:** —

## Objetivo
Lembretes de evento: um cron (tick 5min) que busca `events` com `start_at - reminder_offset <= now()` (e ainda não notificados), dispara notificação para o organizador (sistema de notificações interno) e, opcionalmente, mensagem WhatsApp para o contato participante via o canal padrão do workspace. Cancelamento notifica todos os participantes.

## Escopo (faz)
- `apps/workers/src/calendar-reminders/**`: tick 5min idempotente (marca `reminded_at`/flag para não duplicar), resolve participantes (member organizer + contact attendee), dispara notificação interna + outbound WhatsApp opcional (publica `outbound.request` no pipeline F1-S07).
- Wiring do seam `onEventChanged` (cancel → notifica) de F7-S03, se aplicável (gap-fill orchestrator).
- Registro no bootstrap + scheduler (gap-fill orchestrator).

## Fora de escopo
- Schema (F7-S01), event service (F7-S03), UI de configuração de lembrete (F7-S06 EventForm).

## Arquivos permitidos
- `apps/workers/src/calendar-reminders/**`

## Definition of Done
- [ ] Cron enfileira lembretes de eventos próximos (1d/1h configurável) sem duplicar (idempotente por `reminded_at`); outbound WhatsApp ao contato via canal padrão quando houver.
- [ ] Cancelamento de evento notifica participantes.
- [ ] `pnpm --filter @hm/workers test` (db/mq mockados) + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Reusa o pipeline outbound (F1-S07) para o WhatsApp — não reimplementa envio. Latência alvo: lembrete disparado no offset configurado (§6).
