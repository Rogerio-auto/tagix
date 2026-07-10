---
id: F56-S07
title: Anti-SSRF em webhooks outbound (allowlist de host/esquema)
phase: F56
status: done
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-10T04:20:28Z

---
# F56-S07 — Anti-SSRF em webhooks outbound (SEC-01)

> **Origem:** AUDITORIA_TECNICA.md §3.1. A URL de webhook é validada só por `z.string().url()` — aceita `169.254.169.254`, `localhost`, RFC1918; o `/test` retorna status HTTP síncrono → SSRF semi-cega acionável por qualquer tenant com `webhook.edit`.

## Objetivo

Impedir que webhooks outbound alcancem hosts internos/privados, fechando o único caminho de SSRF acionável por tenant.

## Contexto / causa raiz (verificada)

`apps/api/src/routes/dev/webhooks.ts:43,52` valida `z.string().url().max(2000)`; `apps/workers/src/webhooks/dispatcher.ts:164` faz `fetch(row.url)` sem checar IP. O endpoint de teste devolve reachability/status ao cliente.

## Escopo (faz)

- Guarda SSRF reutilizável em `packages/shared/src/net/**`: aceitar só `https:` (e `http:` se allowlist), resolver hostname e rejeitar loopback/link-local/privado/metadata (`169.254.169.254`, `::1`, `fd00::/8`), com re-checagem de IP no connect (anti-rebinding via `lookup` custom).
- Aplicar no schema Zod da URL (rejeição no boundary) e no `fetch` do dispatcher.
- `/test` nunca devolve corpo/erro interno detalhado.

## Escopo (não faz)

- Assinatura/HMAC de webhooks (já OK). Rate-limit de webhooks (fora).

## Arquivos permitidos

- `packages/shared/src/net/**`
- `packages/shared/src/index.ts`
- `apps/api/src/routes/dev/webhooks.ts`
- `apps/workers/src/webhooks/dispatcher.ts`

## Arquivos proibidos

- `apps/api/src/routes/dev/api-keys.ts` · `apps/api/src/routes/dev/index.ts`

## Definition of Done

- [ ] URL para IP privado/loopback/metadata é rejeitada no create e no dispatch (teste).
- [ ] Re-checagem de IP no connect (anti-DNS-rebinding).
- [ ] `/test` não vaza status/corpo de host interno.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- `packages/shared/src/index.ts` é barrel — adicione só o export do novo módulo `net`; evite reordenar exports existentes (reduz conflito de merge).
