---
id: F45-S06
title: Reações de emoji nas bolhas de mensagem
phase: F45
status: blocked
priority: medium
estimated_size: M
depends_on: [F45-S02]
blocks: []
agent_id: frontend-engineer
security_review: none
source_docs:
  - docs/features/RICH_COMPOSER.md
  - docs/UX_PRINCIPLES.md
---
# F45-S06 — Reações nas bolhas

> **source_docs:** `docs/features/RICH_COMPOSER.md` §1,§4. **depends_on:** F45-S02 (kind `reaction`).
> **blocks:** —. *(standalone — não toca o composer)*

## Objetivo

Permitir **reagir com emoji** a uma mensagem recebida (hover/long-press na bolha → mini-picker
→ envia `type:'reaction'`) e **exibir** as reações na bolha (próprias e do contato).

## Contexto

S02 adiciona o kind `reaction` (referencia o `external_id` da mensagem-alvo) e o inbound já
tem evento `reaction`. Este slot é a camada visual — vive em `ThreadMessages`/`MessageBubble`,
isolado do composer, logo paraleliza com S03–S05.

## Escopo (faz)

- `ReactionPicker.tsx`: mini-picker de emojis frequentes (👍❤️😂😮😢🙏 + "mais") ancorado na bolha.
- `MessageBubble.tsx`/`ThreadMessages.tsx`: gatilho em hover (desktop) / long-press (mobile);
  render do "chip" de reação na bolha; otimista (UX §2.7) com rollback no erro.
- `useReactions.ts`: mutation `POST /api/conversations/:id/messages` com `type:'reaction'`,
  `payload:{ targetMessageId, emoji }` (emoji `''` remove a própria reação). Atualiza o cache local.
- Exibir reação inbound: consumir o campo de reação no `MessageItem` (se o inbound já popular;
  senão, somente reações outbound nesta entrega + nota de follow-up).

## Fora de escopo

- Backend do envio/inbound de reação (S02 + pipeline inbound). Composer (S03–S05).
- Contagem agregada multi-usuário (1 reação por membro no MVP).

## Arquivos permitidos

- `apps/web/features/conversations/components/ReactionPicker.tsx`
- `apps/web/features/conversations/components/MessageBubble.tsx`
- `apps/web/features/conversations/components/ThreadMessages.tsx`
- `apps/web/features/conversations/hooks/useReactions.ts`

## Arquivos proibidos

- `MessageComposer/**` (S03–S05), `queries.ts` (S03), `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Hover/long-press na bolha abre o picker; escolher emoji envia `type:'reaction'` (otimista).
- [ ] Reagir de novo troca; emoji vazio remove a reação.
- [ ] Chip de reação aparece na bolha; rollback visível em erro de envio.
- [ ] Zero `any`; nenhum hex hardcoded (DS v2); `pnpm --filter @hm/web typecheck` + `lint` + `build` verdes.

## UX considerations

- `docs/UX_PRINCIPLES.md`: ação contextual na bolha (hover/long-press), picker ancorado, otimista;
  alvo de toque ≥44px no mobile.

## Permission scope

- `conversation.assign` (STAFF) — `docs/features/PERMISSIONS.md §2`.

## Validação

```bash
pnpm install
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Confirmar os nomes reais de `MessageBubble`/`ThreadMessages`
  em `features/conversations/components/` ao começar (ajustar `files_allowed` se o caminho diferir).
  Exibição de reação **inbound** depende do parser inbound popular o campo — se não popular, escopar
  a esta entrega só o outbound e abrir follow-up.
