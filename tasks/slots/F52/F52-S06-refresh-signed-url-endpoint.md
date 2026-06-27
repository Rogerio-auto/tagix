---
id: F52-S06
title: Endpoint de refresh de signed URL de mídia expirada
phase: F52
status: available
priority: medium
estimated_size: S
depends_on: []
blocks: [F52-S07]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
---
# F52-S06 — Refresh de signed URL de mídia

> **Origem:** survey desta sessão. Signed URLs do R2 têm TTL (7d inbound / 1h outbound em flows); quando expiram, o frontend mostra imagem quebrada sem recuperação.

## Objetivo

Expor um endpoint que regenera a signed URL de uma mídia já armazenada (a partir da `mediaKey` persistida), para o frontend reidratar mídia cuja URL assinada expirou — sem F5.

## Contexto

A mídia é armazenada no R2 com uma `mediaKey` estável (em `messages.metadata.mediaKey`); a `mediaUrl` entregue é apenas uma signed URL temporária. Hoje não há como pedir uma URL nova quando ela expira.

## Escopo (faz)

- **`GET /api/conversations/:id/messages/:messageId/refresh-media-url`** (ou caminho equivalente sob o router de conversas): valida visibilidade da conversa (mesma authz dos demais endpoints por-conversa — IDOR-safe), lê a `mediaKey`, gera nova signed URL e retorna `{ mediaUrl, expiresAt }`.
- Registrar a rota no router de conversas (`routes/conversations/index.ts`), em arquivo novo (`routes/conversations/media.ts`).
- 404 se a mensagem não tem mídia armazenada; 403/404 se a conversa não é visível ao membro.

## Fora de escopo

- Worker de mídia / download / retry (F52-S05).
- Frontend `onerror` handler que chama este endpoint (F52-S07).
- Mudar `messages.ts` (rota de envio — é de F52-S04); usar arquivo novo `media.ts`.

## Arquivos permitidos

- `apps/api/src/routes/conversations/media.ts`
- `apps/api/src/routes/conversations/index.ts`

## Arquivos proibidos

- `apps/api/src/routes/conversations/messages.ts` (F52-S04) · `apps/api/src/app.ts` (F52-S09) · `apps/web/**`

## Contratos de saída

- `GET .../refresh-media-url` → `200 { mediaUrl: string, expiresAt: string }` | `404` | `403`.

## Definition of Done

- [ ] Endpoint retorna nova signed URL válida a partir da `mediaKey`.
- [ ] Authz: membro sem visibilidade da conversa recebe 404 (reusar o guard `assertConversationVisible`/equivalente).
- [ ] Teste: mídia sem key → 404; com key → URL nova com `expiresAt` futuro.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Permission scope

Endpoint por-conversa: respeita visibilidade de conversa (ver `docs/features/PERMISSIONS.md` e o padrão de `assertConversationVisible` da F30). IDOR é parte do DoD.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Reusar o `IStorage`/R2 driver (`packages/storage`) para gerar a signed URL — não reimplementar presign.
- Confirmar onde a `mediaKey` está persistida (`metadata.mediaKey`) antes de assumir o shape.
