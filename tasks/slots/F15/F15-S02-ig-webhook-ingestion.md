---
id: F15-S02
title: Webhook IG ingestion — /webhooks/meta parseia entries IG + dedup + enqueue
phase: F15
status: done
priority: high
estimated_size: M
depends_on: [F15-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/INSTAGRAM.md
claimed_at: 2026-06-12T23:57:21Z
completed_at: 2026-06-13T00:00:44Z

---
# F15-S02 — Webhook IG ingestion (API)

> **source_docs:** `docs/features/INSTAGRAM.md` §4
> **blocks:** F15-S03

## Objetivo

Estender o webhook unificado `/webhooks/meta` (que hoje trata WhatsApp) para reconhecer e ingerir os entries do Instagram (`object: 'instagram'` / `entry[].messaging[]` + `entry[].changes[]`): verificar signature (compartilhada), deduplicar por event id, resolver o `channel` pelo `igUserId`/page, e enfileirar os eventos para o worker inbound — **sem regredir o caminho WhatsApp**.

## Contexto

`apps/api/src/routes/webhooks/meta.ts` já recebe o POST da Meta e roteia WA. O parsing IG fica no adapter (F15-S01); este slot conecta o webhook ao adapter e à fila inbound, reusando dedup (`dedup.ts`/`event-id.ts`) e signature (`signature.ts`).

## Escopo (faz)

- `apps/api/src/routes/webhooks/meta.ts`: detectar payload IG, resolver channel por `igUserId`, chamar `MetaInstagramAdapter.parseInbound`, dedup por event id, publicar na fila inbound (mesma topologia que WA).
- Helper de roteamento IG em `apps/api/src/routes/webhooks/**` se necessário (novo arquivo dedicado, sem tocar o de WA).
- Persistir `webhook_events.raw_payload` (audit/replay, INSTAGRAM.md §3.5/§4.4) se ainda não coberto.

## Fora de escopo

- Parsing em si (F15-S01). Persistência de mensagens (F15-S03). Subscription no connect (F15-S06).

## Arquivos permitidos

- `apps/api/src/routes/webhooks/meta.ts`
- `apps/api/src/routes/webhooks/meta-instagram.ts` (novo, se precisar isolar o roteamento IG)

## Arquivos proibidos

- `apps/api/src/routes/webhooks/waha.ts`, `signature.ts`, `dedup.ts`, `event-id.ts` (reusar, não reescrever)

## Definition of Done

- [ ] POST IG (`object:'instagram'`) é verificado (signature), deduplicado e enfileirado p/ inbound; channel resolvido por `igUserId`.
- [ ] Caminho WhatsApp **inalterado** (testes de webhook WA verdes).
- [ ] Signature inválida → 401/403 antes de qualquer parse; dedup evita reprocesso.
- [ ] `pnpm --filter @hm/api test` (webhook IG) + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Reusa a função de signature compartilhada WA+IG (INSTAGRAM.md §4.3) e o dedup existente. O wire (se criar router IG separado) o orchestrator monta — mas o ideal é estender o `meta.ts` que já está montado.
