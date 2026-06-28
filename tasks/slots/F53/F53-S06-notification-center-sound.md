---
id: F53-S06
title: Central de notificações persistente + som
phase: F53
status: done
priority: high
estimated_size: M
depends_on: [F53-S05]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_AGENDA.md
  - docs/UX_PRINCIPLES.md
  - docs/MOBILE_UX.md
ux_considerations:
  - "Aplica 2.12 — nível 'inbox' persistente até descartar/concluir; agrupamento; sem spam."
  - "Aplica 2.7 — botão 'Abrir conversa' com feedback; ação clara."
  - "Aplica 3.10 — destaque visual e som curtos/intencionais; respeita prefers-reduced-motion."
  - "Aplica 2.4 — entrada óbvia (sino de notificações, ícone universal aceito)."
completed_at: 2026-06-28T16:41:11Z

---
# F53-S06 — Central de notificações persistente + som

## Objetivo

Central de notificações in-app que consome `appointment:due` (S05): card persistente até o operador
descartar ou concluir, com nome do cliente + descrição + botão "Abrir conversa", e **som configurável**.

## Contexto

S05 publica `appointment:due` via socket. Hoje não há central de notificações in-app no web (cada feature
trata seus eventos). Este slot cria a central reusável e as preferências de som, fechando o ciclo de
"receber lembrete no momento certo".

## Escopo

### files_allowed

- `apps/web/features/notifications/**`
- `apps/web/features/settings/sections/personal/NotificationsSection.tsx`
- `apps/web/features/settings/sections/personal/queries.ts` (estender tipo `notificationPrefs` com prefs de som)
- `apps/web/shared/realtime/useAppointmentDue.ts`
- `apps/web/shared/components/layout/TopBar.tsx` (sino + badge de não-lidas)
- `apps/web/shared/components/layout/AppLayout.tsx` (montar a central uma vez, ao lado do CommandPalette)
- `apps/api/src/routes/members/me.ts` (estender Zod de `notificationPrefs` p/ aceitar prefs de som — fonte da verdade no servidor)

### files_forbidden

- `apps/web/shared/realtime/SocketProvider.tsx` (consumir via hook, não reescrever o provider),
  `apps/web/features/conversations/**`, `apps/web/features/cockpit-agenda/**`

## Escopo (faz)

- `useAppointmentDue.ts`: hook que assina `appointment:due` no socket (via `window.__hmSocket`/contexto)
  e empurra para o store da central.
- `features/notifications`: central persistente (overlay a partir do sino no topo). Cada notificação:
  nome do cliente, descrição/tipo, horário, **"Abrir conversa"** (`conversationId` → `/conversations/:id`),
  ações descartar / marcar concluído (chama `PUT /api/events/:id` status `completed`). Persiste até ação
  (UX §2.12 nível inbox). Agrupa múltiplas do mesmo contato. Destaque visual (DS v2, sem hex).
- **Som**: tocar ao chegar notificação, respeitando preferências; "repetir até confirmação" reativa em
  intervalo até o operador descartar/concluir; `prefers-reduced-motion`/aba oculta tratados.
- `NotificationsSection`: toggles **som on/off, volume, repetir até confirmação, apenas visual** (persiste
  via `useUpdateMe` em `notificationPrefs`, padrão já existente).

## Fora de escopo

- Emissão do evento (S05). Card do Cockpit (S04). Push/email (futuro).

## Contratos de entrada/saída

- Consome socket `appointment:due` (definido em S05).
- Conclusão chama `PUT /api/events/:id` (S02) com `status: 'completed'`.

## Permission scope

Pessoal — sem permissão nova. Notificações respeitam o membro logado (room `member:<id>`).

## Definition of Done

- [ ] `appointment:due` renderiza card persistente com nome do cliente + descrição + "Abrir conversa".
- [ ] Descartar/concluir remove da central (concluir transiciona o evento via API).
- [ ] Som configurável (on/off, volume, repetir, só visual) persistido nas prefs; respeita reduced-motion.
- [ ] Agrupamento por contato; sem spam. Mobile: usável (sheet/overlay; alvos ≥ 44px).
- [ ] `pnpm typecheck`, `pnpm lint` verdes; teste do slot passa.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

Reusar o `SocketProvider`/`window.__hmSocket` existentes (consumir, não reescrever). Asset de som
pequeno e local. e2e não valida neste host — usar typecheck/lint/unit.
