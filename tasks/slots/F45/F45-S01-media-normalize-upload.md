---
id: F45-S01
title: Normalização de mídia no upload (voz→ogg/opus, sticker→webp 512²)
phase: F45
status: done
priority: high
estimated_size: M
depends_on: []
blocks: [F45-S04, F45-S05]
agent_id: backend-engineer
security_review: required
source_docs:
  - docs/features/RICH_COMPOSER.md
completed_at: 2026-06-28T22:19:00Z

---
# F45-S01 [SEC] — Normalização de mídia no upload

> **source_docs:** `docs/features/RICH_COMPOSER.md` §1, §2. **depends_on:** nenhum (onda 1). **blocks:** F45-S04, F45-S05.

## Objetivo

Transformar a mídia no momento do upload para os formatos que o WhatsApp exige nas
modalidades novas: **áudio de nota de voz → `audio/ogg` codec OPUS** (ffmpeg) e
**imagem marcada como sticker → `image/webp` 512×512** (sharp). O `POST /api/uploads`
passa a aceitar uma intenção (`as=voice|sticker|auto`) e devolve a URL já normalizada.

## Contexto

`MediaRecorder` do navegador gera `webm/opus`/`mp4` — nenhum é o `ogg/opus` que o
WhatsApp precisa para nota de voz nativa. Sticker precisa ser webp 512². A
normalização tem que acontecer **antes** da URL ser finalizada (a Meta busca o
binário pelo link), logo é server-side no upload. Desbloqueia o gravador de voz
(S04) e o sticker picker (S05).

## Escopo (faz)

- Em `apps/api/src/routes/uploads.ts`: aceitar query/campo `as` (`voice` | `sticker` | `auto`,
  default `auto`). Quando `as=voice` e o input é áudio → transcode para `audio/ogg;codecs=opus`
  (mono, ~48kHz) via ffmpeg; gravar com content-type `audio/ogg`. Quando `as=sticker` e o input
  é imagem → converter para `image/webp` 512×512 (sharp, `fit:contain`, fundo transparente),
  garantir ≤100 KB (estático). Caso contrário, comportamento atual (passthrough).
- Util novo em `apps/api/src/media/normalize.ts` (+ `index.ts`): `transcodeToOpusOgg(buf)` e
  `toStickerWebp(buf)`. ffmpeg via `child_process` com **args em array** (nunca shell string →
  sem injeção); timeout + limite de tamanho de saída; validar magic-bytes do input.
- `apps/api/Dockerfile`: instalar `ffmpeg` na imagem (apt). `apps/api/package.json`: dep `sharp`.
- Erros tipados (415 mídia não suportada, 422 falha de transcode) com `ref` no padrão da API.

## Fora de escopo

- Serializer `voice:true` / novos kinds (S02). UI de gravação/sticker (S04/S05).
- Conversão de vídeo, legendagem, thumbnails.

## Arquivos permitidos

- `apps/api/src/routes/uploads.ts`
- `apps/api/src/media/**`
- `apps/api/Dockerfile`
- `apps/api/package.json`
- `apps/api/src/routes/uploads.test.ts`

## Arquivos proibidos

- `apps/workers/**`, `packages/channels/**` (S02)
- `apps/web/**` (S04/S05)

## Contratos de entrada/saída

- `POST /api/uploads?filename=<nome>&as=<voice|sticker|auto>` (body = binário cru, cookie de sessão)
  → `200 { fileUrl: string, key: string, mime: string }`. `mime` reflete o formato **após**
  normalização (`audio/ogg` para voice; `image/webp` para sticker).

## Definition of Done

- [ ] `as=voice` produz `audio/ogg;codecs=opus` válido (verificado por `ffprobe`/magic-bytes no teste).
- [ ] `as=sticker` produz `image/webp` 512×512 ≤100 KB.
- [ ] ffmpeg invocado com args em array + timeout; nenhum input do usuário concatenado em shell.
- [ ] Allowlist de content-type mantida; input inválido → 415; falha de transcode → 422 com `ref`.
- [ ] `apps/api/Dockerfile` instala ffmpeg; `sharp` adicionado e buildando na imagem Linux.
- [ ] `pnpm typecheck` + `pnpm lint` verdes; teste do feliz path passa.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. **[SEC]** gate `security-auditor` antes do finish: foco em
  (a) command-injection no ffmpeg (args array, sem `shell:true`), (b) DoS por mídia gigante /
  zip-bomb (limite de tamanho já no `express.raw` + timeout no transcode), (c) magic-bytes vs
  content-type declarado. `sharp` já é dep transitiva do Next em outros pacotes — confirmar build
  Linux na imagem (musl/glibc). PTT só vira "nativo" com `voice:true` no serializer (S02): este
  slot só garante o formato do arquivo.
