---
id: F30-S03
title: Inbox UI — cockpit no painel + header espelho + filtros
phase: F30
status: done
priority: high
estimated_size: L
depends_on: [F30-S01, F30-S02, F30-S07]
agent_id: frontend-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/features/LIVECHAT.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-14T17:12:58Z
completed_at: 2026-06-14T17:24:31Z

---
# F30-S03 — Inbox UI (cockpit + header espelho + filtros)

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §3; `LIVECHAT.md` §7; `UX_PRINCIPLES.md` §2/§3/§4
> **blocks:** —

## Objetivo

Transformar o painel direito no **centro de comando completo** da conversa (status, atribuir/transferir, toggle IA + estado de handoff, contexto canal/dept/atendente, histórico de routing) e fazer o **header virar espelho condicional**: atalhos de ação só quando o painel está fechado, somem quando ele abre. Inclui os filtros de inbox (dept/time/atendente) coerentes com a visibilidade.

## Contexto

Hoje o header tem só label + badge + Info, e o `RoutingMenu` está enterrado no painel passando `assignedTo={null} departmentId={null}` hardcoded. Este slot consome as APIs de S02 (status/ai_mode), `routing.ts` (assign/transfer já existente) e a list escopada de S07.

## Escopo (faz)

- `apps/web/features/conversations/components/ContactInfoPanel.tsx` (editar) — vira o cockpit completo: blocos de Status, Atribuição (RoutingMenu ligado ao **estado real**), IA (toggle on/off/paused + indicador "IA pausada — atendente assumiu" + botão Retomar), Contexto (canal/dept/atendente/estágio chips), histórico de routing, notas.
- `apps/web/features/conversations/components/ConversationHeader/**` (novo) — header com atalhos de ação (status, atribuir, IA) que **só renderizam quando o painel está fechado** (prop `panelOpen`).
- `apps/web/features/conversations/components/ConversationsLayout.tsx` (editar) — gerencia `panelOpen`, passa pro header, monta o ConversationHeader.
- `apps/web/features/conversations/components/RoutingMenu/RoutingMenu.tsx` + `queries.ts` (editar) — receber `assignedTo`/`departmentId` reais (corrige o `null` hardcoded).
- `apps/web/features/conversations/components/ChatList/ChatListFilters.tsx` (editar) — adicionar filtros departamento / time / atendente (me/outros).
- `apps/web/features/conversations/queries.ts` + `types.ts` (editar) — mutations de status/ai-mode + tipos.
- Indicador de IA (on/paused) no item da lista: `ChatList/ChatListItem.tsx` (editar) — badge discreto.

## Fora de escopo

- Backend (S02/S07), settings de visibilidade (S10), pipeline/estágio dentro do chat (Onda D — só exibir o chip de estágio se já vier no payload).
- `useChatList.ts` fica para S10 (filtros de query) — aqui só a UI de filtro dispara o estado; **não editar `useChatList.ts`**.

## Arquivos permitidos

- `apps/web/features/conversations/components/ContactInfoPanel.tsx`
- `apps/web/features/conversations/components/ConversationHeader/**`
- `apps/web/features/conversations/components/ConversationsLayout.tsx`
- `apps/web/features/conversations/components/RoutingMenu/**`
- `apps/web/features/conversations/components/ChatList/ChatListFilters.tsx`
- `apps/web/features/conversations/components/ChatList/ChatListItem.tsx`
- `apps/web/features/conversations/queries.ts`
- `apps/web/features/conversations/types.ts`

## Arquivos proibidos

- `apps/web/features/conversations/hooks/useChatList.ts` (S10)
- `apps/web/features/settings/**` (S10)
- `packages/**`, `apps/api/**`

## Definition of Done

- [ ] Painel direito completo (status/assign/IA/contexto/histórico); ações funcionam ponta-a-ponta.
- [ ] Header espelho: ações visíveis só com painel fechado; somem ao abrir.
- [ ] RoutingMenu reflete estado real (sem `null` hardcoded).
- [ ] Toggle IA + indicador de handoff + botão Retomar; badge de IA na lista.
- [ ] Filtros dept/time/atendente na ChatList.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- Aplica §2.3 — detalhe/ações em **drawer/painel lateral**, nunca modal full-screen.
- Aplica §2.4 — ações com **path de entrada óbvio** (não escondidas em kebab); label + ícone.
- Aplica §2.7 — toda ação assíncrona com feedback < 100ms (loading/disabled) + toast.
- Aplica §2.9 — histórico de routing como **timeline** vertical.
- Aplica §2.11 — erros em 3 partes (o quê / por quê / o que fazer).
- Aplica §3.1 — selecionar antes de agir; §3.5 — cursor/hover ensinam.
- Checklist `UX_PRINCIPLES.md §4` aplicável marcado.

## Permission scope

UI esconde ações via `can(role, ...)` (`conversation.resolve/snooze/ai_mode/assign/transfer`); autoridade é server-side (S02/S07/routing). `PERMISSIONS.md §3.2`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. DS v2: zero hex hardcoded, tokens de `@hm/design-tokens`.
- Slot L — se passar de ~500 linhas úteis de diff, sinalize quebra (ex.: extrair filtros pra sub-slot), mas o cockpit + header são coesos e devem ficar juntos.
