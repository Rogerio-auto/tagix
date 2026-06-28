---
id: F54-S02
title: Ouvinte de tempo real de compromissos (useEventsRealtime + mount global)
phase: F54
status: done
priority: high
estimated_size: S
depends_on: [F54-S01]
blocks: [F54-S05]
agent_id: frontend-engineer
source_docs:
  - docs/features/AGENDA_SYNC.md
completed_at: 2026-06-28T20:11:35Z

---
# F54-S02 — Ouvinte de tempo real de compromissos

## Objetivo

Manter Cockpit **e** Agenda Central sempre atualizados sozinhos: um único ouvinte que assina
`event:created/updated/deleted` e invalida o cache de eventos. Bidirecional por construção (o cache
TanStack Query é global — invalidar de um ponto atualiza todas as telas).

## Contexto

`features/calendar/queries.ts` usa as keys `['events', ...]` e `['event', id]`. O `SocketProvider`/
`useSocket()` já existem (consumir, não reescrever). Padrão de referência: como o web ouve `deal:*`
(F5-S07) — replicar para eventos.

## Escopo

### files_allowed
- `apps/web/shared/realtime/useEventsRealtime.ts` (NOVO)
- `apps/web/shared/components/layout/AppLayout.tsx` (montar o hook 1×)
- `apps/web/shared/realtime/__tests__/**` (se aplicável)

### files_forbidden
- `apps/web/shared/realtime/SocketProvider.tsx` (consumir via `useSocket()`), `features/calendar/**`
  (dono: S03), `features/cockpit-agenda/**`

## Escopo (faz)
- `useEventsRealtime.ts`: assina `event:created/updated/deleted` via `useSocket()`; em cada um,
  `queryClient.invalidateQueries({ queryKey: ['events'] })` e, no updated/deleted, também
  `['event', payload.eventId]`. Debounce/coalesce opcional para rajadas. Cleanup do listener no unmount.
- Montar `useEventsRealtime()` **uma vez** num componente do `AppLayout` (ao lado dos provedores
  globais, ex.: junto do `NotificationCenter`), para valer em qualquer rota.

## Fora de escopo
- Render da lista/cartões (S03). Emit no backend (S01). Worker (S04).

## Contratos de entrada
- Consome `event:created|updated|deleted` (definidos em S01).

## Definition of Done
- [ ] Hook assina os 3 eventos e invalida `['events']` (+`['event', id]`); cleanup no unmount.
- [ ] Montado 1× no AppLayout; criar no Cockpit reflete na Agenda sem refresh (e vice-versa).
- [ ] `pnpm typecheck`, `pnpm lint` verdes; teste do slot passa. Zero `any`.

## Validação
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas
e2e não roda neste host — validar por typecheck/lint/unit. Reusar `useSocket()`; NÃO reescrever o
provider. Edição no AppLayout é cirúrgica (import + 1 mount).
