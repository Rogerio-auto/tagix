---
id: F36-S03
title: Inbox/cockpit responsivo — pilha de views + sheets
phase: F36
status: done
priority: high
estimated_size: L
depends_on:
  - F36-S01
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
  - docs/features/LIVECHAT_OPS.md
agent_id: frontend-engineer
claimed_at: 2026-06-16T20:14:19Z
completed_at: 2026-06-16T20:21:42Z

---
# F36-S03 — Cockpit responsivo

## Objetivo

Transformar o cockpit de 3 colunas fixas em uma experiência mobile fluida: navegação em **pilha de views** (Lista → Thread → Cockpit), composer fixo no rodapé com safe-area, e os menus (AgentSelector, RoutingMenu, SnoozeMenu) como **sheets**.

## Contexto

`ConversationsLayout` é 3 colunas (`w-80` + flex + `w-80`) travadas em telas estreitas. É a tela de maior tráfego (atendentes no celular). Consome `Sheet`/`useBreakpoint` de S01.

## Escopo (faz)

- **`apps/web/features/conversations/**`** — em `< md`:
  - Lista de conversas em tela cheia; tocar abre a Thread (push de view, com "voltar" preservando scroll/estado da lista).
  - Thread em tela cheia: header compacto (nome + voltar + ação de abrir cockpit), bolhas full-width, composer **fixo no rodapé** com `pb-safe`.
  - Cockpit (ContactInfoPanel) abre como **sheet** (full-sheet) por cima da thread; `AgentSelector`/`RoutingMenu`/`SnoozeMenu` abrem como sheets/menus de toque (não dropdowns desktop).
  - `md+`: layout de 3 colunas atual **intacto** (zero regressão).
- Apenas layout/UX responsivo — nenhuma mudança de API/contrato.

## Fora de escopo

- Mudança de endpoints/queries. Bottom nav (S02).

## Arquivos permitidos

- `apps/web/features/conversations/**`
- `apps/web/app/(app)/conversations/**`

## Arquivos proibidos

- `apps/web/shared/components/Sheet/**` (consome de S01)
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] `< md`: navega Lista↔Thread↔Cockpit em pilha, "voltar" preserva contexto; composer fixo respeitando teclado + safe-area.
- [ ] Menus de agente/roteamento/snooze usáveis no toque (sheets), alvos ≥44px.
- [ ] `md+`: 3 colunas inalteradas (regressão zero).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.3 drawer→sheet; §4 plano: uma intenção por view, thumb-first (composer no rodapé).
- §2.7 skeletons; §2.10 — `Esc`/voltar previsível; gestos com equivalente de toque.
- §3.8 density preservada nas listas.

## Notas

Reusar o socket/realtime e as queries existentes (joinConversation etc.) sem alterá-los. O AgentSelector/Snooze/Routing já existem — só trocar o *container* (dropdown→sheet) no mobile, mantendo a lógica.
