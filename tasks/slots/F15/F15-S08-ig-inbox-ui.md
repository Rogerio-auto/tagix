---
id: F15-S08
title: IG inbox UI — ícone/filtro de canal, comment thread, story mention card, composer 24h/tag
phase: F15
status: blocked
priority: medium
estimated_size: L
depends_on: [F15-S05]
agent_id: frontend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
  - docs/UX_PRINCIPLES.md
---

# F15-S08 — IG inbox UI (frontend)

> **source_docs:** `docs/features/INSTAGRAM.md` §12.2, §12.3, §12.4, §6.2; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Tratar Instagram na inbox (`features/conversations`): distinção visual de canal (ícone IG gradient + filtro IG-only no topbar), UI de **comment thread** (preview do post/reel + cards aninhados + toggle responder público/DM + ocultar/excluir), **story mention card** (preview da mídia + badge + CTA), e **composer lock** da janela 24h com seleção de MESSAGE_TAG.

## Contexto

A inbox já renderiza conversas WA (ChatList/MessageBubble/MessageComposer). Este slot adiciona os tipos/affordances IG, consumindo a API de comments (F15-S05) e os subtipos de mensagem já persistidos (F15-S03). Schema/sockets não mudam (§13).

## Escopo (faz)

- `apps/web/features/conversations/**`: ícone de provider por conversa + filtro de canal (§12.2); render de `message.type` IG (story_mention card §12.4, comment/comment_reply como thread aninhada §12.3); composer com toggle público/DM em comment threads e lock de 24h + selector de MESSAGE_TAG quando fora da janela (§6.2); botões ocultar/excluir comment (chamam F15-S05).

## Fora de escopo

- Connect wizard (F15-S07). Backend (F15-S03/S05).

## Arquivos permitidos

- `apps/web/features/conversations/**`

## Arquivos proibidos

- `apps/web/features/settings/channels/**` (F15-S07), `packages/ui/**`

## Definition of Done

- [ ] Conversa IG distinguível (ícone) + filtro IG-only; comment thread renderiza com preview + aninhamento + toggle público/DM + ocultar/excluir; story mention card com preview e CTA.
- [ ] Composer bloqueia fora da janela 24h e oferece MESSAGE_TAG; WhatsApp na inbox **inalterado**.
- [ ] DS v2 dark-first, tokens semânticos (zero hex); a11y de teclado preservada (não regredir F10-S12).
- [ ] `pnpm --filter @hm/web typecheck` + lint + `build` verdes.

## UX considerations

- **§2.3/§3.2**: detalhe de comment/story em drawer lateral, não modal-cobre-tudo.
- **§2.9** (botão-suicida): excluir comment pede confirmação.
- **§2.5** (tooltip-substituto): explicar a janela 24h/tag com help inline `?` (HelpHint), não tooltip.
- **§2.7** (feedback): ações de moderação mostram resultado; **§3.1** (selecionar antes de agir) no thread.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**.
- Slot grande (L) — se o agente medir >500 linhas úteis, sinalizar p/ o orchestrator quebrar (comment-thread vs story-card vs composer-lock). Paraleliza com F15-S07.
