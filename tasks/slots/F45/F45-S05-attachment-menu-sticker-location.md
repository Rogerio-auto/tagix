---
id: F45-S05
title: Menu de anexo rico — enviar sticker + localização
phase: F45
status: available
priority: medium
estimated_size: L
depends_on: [F45-S01, F45-S02, F45-S03, F45-S04]
blocks: [F45-S07]
agent_id: frontend-engineer
security_review: none
source_docs:
  - docs/features/RICH_COMPOSER.md
  - docs/UX_PRINCIPLES.md
---
# F45-S05 — Menu de anexo: sticker + localização

> **source_docs:** `docs/features/RICH_COMPOSER.md` §1,§3,§4. **depends_on:** F45-S01 (webp),
> F45-S02 (kinds), F45-S03 (action bar), F45-S04 (serializa edições do `MessageComposer.tsx`).
> **blocks:** F45-S07.

## Objetivo

Adicionar um **menu de anexo** (popover "+") na barra do composer com duas modalidades:
enviar **sticker** (imagem escolhida → webp 512² no upload → `type:'sticker'`) e enviar
**localização** (posição atual via geolocation, ou busca, → `type:'location'`).

## Contexto

S01 converte imagem→webp e S02 expõe os kinds `sticker`(media)/`location`. Aqui é a UI:
um menu ancorado que agrupa as ações estruturadas, criando o ponto onde S07 (contato) entra.

## Escopo (faz)

- `AttachmentMenu.tsx`: popover "+" na `ComposerActionBar` listando Sticker e Localização
  (estrutura extensível p/ Contato no S07).
- `StickerPicker.tsx`: escolher imagem (ou de um tray de recentes) → `useMediaUpload(file,{as:'sticker'})`
  → enviar `type:'sticker'` (sem caption). Preview do webp antes de enviar.
- `LocationSender.tsx`: "Usar localização atual" (`navigator.geolocation`) com fallback de busca por
  endereço (campo nome/endereço manual no MVP) → enviar `type:'location'` com `payload:{ latitude,
  longitude, name?, address? }`. Bolha mostra mini-mapa/marker.
- Wire na `ComposerActionBar.tsx`/`MessageComposer.tsx`. Reusa `useSendMessage` (payload já suportado).

## Fora de escopo

- Backend de qualquer tipo (S01/S02). Contato (S07). Reação (S06).
- Mapa interativo com arraste (MVP = atual + endereço manual); pode ser follow-up.

## Arquivos permitidos

- `apps/web/features/conversations/components/MessageComposer/AttachmentMenu.tsx`
- `apps/web/features/conversations/components/MessageComposer/StickerPicker.tsx`
- `apps/web/features/conversations/components/MessageComposer/LocationSender.tsx`
- `apps/web/features/conversations/components/MessageComposer/MessageComposer.tsx`
- `apps/web/features/conversations/components/MessageComposer/ComposerActionBar.tsx`

## Arquivos proibidos

- `VoiceRecorder.*`/`EmojiPicker.*` (S03/S04), `ContactPicker.*` (S07)
- `apps/api/**`, `packages/**`, `ThreadMessages*`/`MessageBubble*` (S06)

## Definition of Done

- [ ] Menu "+" abre/fecha (popover, `Esc`/click-fora); itens Sticker e Localização visíveis.
- [ ] Sticker: imagem → webp 512² (via `as=sticker`) → chega como sticker no WhatsApp (sem caption).
- [ ] Localização atual obtém lat/long e envia; bolha renderiza marker/endereço.
- [ ] Geolocation negada tratada com feedback claro; zero `any`; nenhum hex hardcoded.
- [ ] `pnpm --filter @hm/web typecheck` + `lint` + `build` verdes.

## UX considerations

- `docs/UX_PRINCIPLES.md`: popover ancorado (não modal full-screen); ações nomeadas com ícone+label;
  feedback imediato; permissão de localização degradando graceful.

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

- Especialista: **frontend-engineer**. Edita `MessageComposer.tsx`/`ComposerActionBar.tsx`
  (compartilhados com S03/S04) → sequenciado via `depends_on`. Renderização de bolha de
  location pode reusar primitivos DS v2; sem libs de mapa pesadas no MVP.
