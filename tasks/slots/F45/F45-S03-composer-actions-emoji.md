---
id: F45-S03
title: Refactor da barra de ações do composer + emoji picker
phase: F45
status: done
priority: high
estimated_size: M
depends_on: []
blocks: [F45-S04, F45-S05, F45-S07]
agent_id: frontend-engineer
security_review: none
source_docs:
  - docs/features/RICH_COMPOSER.md
  - docs/UX_PRINCIPLES.md
completed_at: 2026-06-28T22:19:01Z

---
# F45-S03 — Barra de ações do composer + emoji

> **source_docs:** `docs/features/RICH_COMPOSER.md` §3–§4; `docs/UX_PRINCIPLES.md` §2/§3.
> **depends_on:** nenhum. **blocks:** F45-S04, F45-S05, F45-S07. *(scaffold do toolbar — dono de `MessageComposer.tsx`)*

## Objetivo

Refatorar o `MessageComposer` para ter uma **barra de ações explícita** (extensível) ao
lado do input e entregar a primeira modalidade nova: **emoji picker** que insere no
textarea na posição do cursor. Estabelece os pontos de extensão que voz (S04) e
anexo rico (S05) vão preencher.

## Contexto

Hoje o composer só tem o ícone de anexo (Paperclip) e o textarea. As modalidades novas
(voz, sticker, localização) precisam de uma barra de ações coesa. Este slot cria essa
estrutura e adiciona emoji — o de menor risco — validando o padrão.

## Escopo (faz)

- Refatorar `MessageComposer.tsx`: extrair a fileira de botões para `ComposerActionBar.tsx`
  (renderiza ações via lista declarativa; expõe slots para botões adicionais). Mantém anexo + enviar.
- `EmojiPicker.tsx`: popover ancorado (DS v2, dark-first) com busca; ao escolher, insere o
  emoji no `text` na posição do cursor (controla `selectionStart`/`selectionEnd` do textarea).
- Acessibilidade: botão com `aria-label`, popover com foco gerenciado e `Esc` fecha.
- Sem nova dependência pesada se possível (lista curada de emojis + busca simples); se usar
  lib, escolher uma leve e tree-shakeable.

## Fora de escopo

- Gravação de voz (S04), sticker/localização (S05), reação (S06), contato (S07).
- Mudar o contrato de `useSendMessage` além de, no máximo, adicionar `payload?` opcional
  (preparando S05/S07) — sem novas mutations aqui.

## Arquivos permitidos

- `apps/web/features/conversations/components/MessageComposer/MessageComposer.tsx`
- `apps/web/features/conversations/components/MessageComposer/ComposerActionBar.tsx`
- `apps/web/features/conversations/components/MessageComposer/EmojiPicker.tsx`
- `apps/web/features/conversations/components/MessageComposer/index.ts`
- `apps/web/features/conversations/queries.ts`

## Arquivos proibidos

- `MessageComposer/VoiceRecorder.*`, `AttachmentMenu.*`, `StickerPicker.*`, `LocationSender.*` (S04/S05)
- `apps/web/features/conversations/components/ThreadMessages*`, `MessageBubble*` (S06)

## Definition of Done

- [ ] Barra de ações renderiza anexo + emoji + (placeholders desabilitados/ausentes p/ voz/anexo).
- [ ] Emoji insere no cursor, não no fim; não quebra o auto-grow do textarea.
- [ ] Popover fecha com `Esc`/click-fora; foco volta ao textarea.
- [ ] Nenhum hex hardcoded (tokens DS v2); zero `any`.
- [ ] `pnpm --filter @hm/web typecheck` + `lint` + `build` verdes.

## UX considerations

- Aplica `docs/UX_PRINCIPLES.md`: ações visíveis numa barra (evita anti-padrão *gear-only entry*);
  popover ancorado em vez de modal full-screen; feedback imediato. Tooltips nos ícones.

## Permission scope

- Mesma porta do envio: `conversation.assign` (STAFF) — `docs/features/PERMISSIONS.md §2`. READONLY não vê o composer.

## Validação

```bash
pnpm install
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Este é o **scaffold-then-fill**: S04/S05/S07 editam
  `MessageComposer.tsx`/`ComposerActionBar.tsx` depois — por isso são sequenciados via `depends_on`
  (nunca paralelos a este). Deixe a ActionBar pronta para receber itens sem reescrita.
