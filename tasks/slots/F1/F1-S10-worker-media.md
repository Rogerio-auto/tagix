---
id: F1-S10
title: Worker media — download Meta + dedup SHA-256 + upload R2 + signed URL
phase: F1
status: review
priority: high
estimated_size: M
depends_on: [F1-S04, F1-S08, F0-S15]
agent_id: backend-engineer
claimed_at: 2026-06-10T01:02:34Z
completed_at: 2026-06-10T01:02:35Z

---
# F1-S10 — Worker media

> **source_docs:** `docs/features/LIVECHAT.md` §5
> **blocks:** F1-S15 (render mídia)

## Objetivo
Consumir `hm.q.inbound.media`: download via adapter → SHA-256 → dedup → upload R2 (`{wsId}/{y}/{m}/{d}/{uuid}.{ext}`) → update `messages.media_*` → emit `message:media_ready`.

## Escopo (faz)
- `apps/workers/src/media/**` — consumer + download (adapter.downloadMedia) + dedup por media_sha256 + upload (@hm/storage) + update repo + socket relay. Concurrency limit (`OUTBOUND_MEDIA_MAX_CONCURRENCY=2`).

## Arquivos permitidos
- `apps/workers/src/media/**`, `apps/workers/src/index.ts`

## Definition of Done
- [ ] Download+upload+dedup funcionam; placeholder vira mídia carregada via socket.
- [ ] Limite de concorrência respeitado; typecheck + lint + test.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
ffmpeg/sharp (conversão) podem ficar em sub-slot; MVP pode subir o original. URL temporária IG expira rápido → prioridade alta na fila (F1.5).
