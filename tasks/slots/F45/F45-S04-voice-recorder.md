---
id: F45-S04
title: Gravador de nota de voz no composer (MediaRecorder)
phase: F45
status: available
priority: high
estimated_size: M
depends_on: [F45-S01, F45-S02, F45-S03]
blocks: [F45-S05]
agent_id: frontend-engineer
security_review: none
source_docs:
  - docs/features/RICH_COMPOSER.md
  - docs/UX_PRINCIPLES.md
---
# F45-S04 — Gravador de voz

> **source_docs:** `docs/features/RICH_COMPOSER.md` §1,§4. **depends_on:** F45-S01 (transcode ogg/opus),
> F45-S02 (`voice:true`), F45-S03 (action bar). **blocks:** F45-S05.

## Objetivo

Gravar **nota de voz** no navegador e enviá-la como PTT nativo do WhatsApp: botão de
microfone na barra → estado de gravação (timer + onda + cancelar/enviar) → upload como
`as=voice` → envio com `type:'voice'`.

## Contexto

`MediaRecorder` grava `webm/opus`/`mp4`; o S01 transcoda para ogg/opus no upload e o S02
manda `voice:true`. Este slot é a captura + UX. Solução world-class: feedback de onda em
tempo real e cancelamento sem envio acidental.

## Escopo (faz)

- `useVoiceRecorder.ts`: encapsula `getUserMedia({audio})` + `MediaRecorder` escolhendo o mime
  por `isTypeSupported` (candidatos: `audio/webm;codecs=opus`, `audio/ogg;codecs=opus`, `audio/mp4`);
  expõe `start/stop/cancel`, `state`, `elapsedMs`, e o `Blob` final. Libera tracks ao parar.
- `VoiceRecorder.tsx`: UI do estado de gravação que **substitui** o input (timer mm:ss, onda via
  `AnalyserNode`, ✕ cancelar, ➤ enviar). Permissão negada → mensagem clara + volta ao input.
- Wire no `MessageComposer.tsx`/`ComposerActionBar.tsx`: botão de microfone inicia a gravação.
- Envio: `useMediaUpload` ganha suporte a `as` (`upload(blobAsFile, { as:'voice' })`) e o composer
  envia `type:'voice'` com a `mediaUrl` retornada.

## Fora de escopo

- Transcode (S01) e `voice:true` (S02). Sticker/localização (S05). Reação (S06).
- Pausar/retomar gravação (pode ser follow-up); MVP = gravar contínuo + cancelar/enviar.

## Arquivos permitidos

- `apps/web/features/conversations/components/MessageComposer/VoiceRecorder.tsx`
- `apps/web/features/conversations/components/MessageComposer/useVoiceRecorder.ts`
- `apps/web/features/conversations/components/MessageComposer/MessageComposer.tsx`
- `apps/web/features/conversations/components/MessageComposer/ComposerActionBar.tsx`
- `apps/web/features/conversations/components/MessageComposer/useMediaUpload.ts`

## Arquivos proibidos

- `EmojiPicker.tsx` (S03), `AttachmentMenu.*`/`StickerPicker.*`/`LocationSender.*` (S05)
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Mic → grava → enviar produz uma mensagem `voice` que chega como **nota de voz** (player) no WhatsApp.
- [ ] Cancelar descarta sem enviar e sem deixar tracks de áudio abertos (mic apaga).
- [ ] Permissão negada tratada com feedback (sem crash); timer e onda funcionam.
- [ ] `as=voice` propagado ao `/api/uploads`; sem `any`; nenhum hex hardcoded.
- [ ] `pnpm --filter @hm/web typecheck` + `lint` + `build` verdes.

## UX considerations

- `docs/UX_PRINCIPLES.md`: estado de gravação dedicado (não envia ao soltar fora — evita ação
  acidental); feedback em tempo real (onda/timer, §2.7); foco e `Esc` cancelam.

## Permission scope

- `conversation.assign` (STAFF). Pedido de mic é do navegador; degrade graceful se negado.

## Validação

```bash
pnpm install
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. e2e de mic não roda no headless deste host (ver memória
  `e2e-no-hydration-this-host`) → validar por typecheck/lint/build + teste manual. Edita
  `MessageComposer.tsx`/`ComposerActionBar.tsx` (compartilhados) — por isso depende de S03 e
  bloqueia S05 (serialização das edições no mesmo arquivo).
