---
id: F45-S07
title: Enviar contato do workspace
phase: F45
status: available
priority: low
estimated_size: M
depends_on: [F45-S02, F45-S03, F45-S05]
blocks: []
agent_id: frontend-engineer
security_review: none
source_docs:
  - docs/features/RICH_COMPOSER.md
  - docs/UX_PRINCIPLES.md
---
# F45-S07 — Enviar contato

> **source_docs:** `docs/features/RICH_COMPOSER.md` §1,§3. **depends_on:** F45-S02 (kind `contacts`),
> F45-S03 (action bar), F45-S05 (`AttachmentMenu`). **blocks:** —. *(prioridade baixa)*

## Objetivo

Compartilhar um **contato** numa conversa: item "Contato" no menu de anexo → escolher um
contato do workspace → enviar `type:'contact'` com o cartão (nome + telefones + emails).

## Contexto

Última modalidade do conjunto; menos pedida. Reusa o `AttachmentMenu` (S05) e o kind
`contacts` (S02). Mantido como slot separado e opcional para não inflar S05.

## Escopo (faz)

- `ContactPicker.tsx`: busca/seleção de um contato existente do workspace (reusa a query de
  contatos já existente em `features/contacts` ou endpoint equivalente; somente leitura).
- Item "Contato" no `AttachmentMenu.tsx`; ao confirmar, mapeia o contato para o
  `payload:{ contacts:[{ name, phones:[…], emails?:[…] }] }` e envia via `useSendMessage`.
- Bolha renderiza o cartão de contato enviado (nome + telefone principal).

## Fora de escopo

- Backend (S02). Criar/editar contato (é outra feature). Sticker/localização/voz/emoji/reação.

## Arquivos permitidos

- `apps/web/features/conversations/components/MessageComposer/ContactPicker.tsx`
- `apps/web/features/conversations/components/MessageComposer/AttachmentMenu.tsx`

## Arquivos proibidos

- Demais arquivos do `MessageComposer/**` (S03–S05), `apps/api/**`, `packages/**`, `features/contacts/**` (só leitura via query pública)

## Definition of Done

- [ ] Item "Contato" no menu; picker lista/busca contatos do workspace (RLS no backend de origem).
- [ ] Enviar produz `type:'contact'` com payload válido; chega como cartão de contato no WhatsApp.
- [ ] Bolha de contato enviado renderiza nome + telefone; zero `any`; sem hex hardcoded.
- [ ] `pnpm --filter @hm/web typecheck` + `lint` + `build` verdes.

## UX considerations

- `docs/UX_PRINCIPLES.md`: busca dentro do popover; confirma antes de enviar; feedback imediato.

## Permission scope

- `conversation.assign` (STAFF) — `docs/features/PERMISSIONS.md §2`. Leitura de contatos respeita a
  visibilidade já imposta pela feature de contatos.

## Validação

```bash
pnpm install
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Edita `AttachmentMenu.tsx` (criado no S05) → sequenciado
  após S05. Confirmar a query de contatos disponível ao começar; não duplicar fetch de contatos.
