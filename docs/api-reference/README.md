# Highermind Public API — site de documentação (Mintlify)

Site de referência da **API pública v1** (F9). É **markdown-based** (Mintlify) —
não é um app do monorepo, não tem `package.json` próprio e não participa do
`pnpm-workspace`. São só arquivos `.mdx` + `mint.json` + um snapshot OpenAPI.

## Estrutura

```
docs/api-reference/
  mint.json                    # config de navegação/tema/OpenAPI do Mintlify
  introduction.mdx             # overview + URL base + primeiros passos
  guides/
    authentication.mdx         # API key (Bearer hm_...), scopes, isolamento
    api-keys.mdx               # ciclo de vida das chaves (Settings → Dev)
    rate-limits.mdx            # limite por chave + headers X-RateLimit-* + 429
    errors.mdx                 # corpo de erro padronizado + tabela de códigos
    pagination.mdx             # limit/status/ordenação do GET conversations
    webhooks.mdx               # HMAC (x-hm-signature-256), retry, idempotência
    webhook-events.mdx         # catálogo de eventos assináveis
  endpoints/
    send-message.mdx           # POST /api/v1/send_message
    send-template.mdx          # POST /api/v1/send_template
    upsert-contact.mdx         # POST /api/v1/upsert_contact
    trigger-flow.mdx           # POST /api/v1/trigger_flow
    list-conversations.mdx     # GET  /api/v1/conversations
    get-conversation.mdx       # GET  /api/v1/conversations/{id}
  openapi/
    v1.json                    # snapshot da spec OpenAPI 3.1 da v1 (ver abaixo)
```

As páginas em `endpoints/` declaram `openapi: "<METHOD> <path>"` no frontmatter —
o Mintlify renderiza os painéis de request/response **a partir de `openapi/v1.json`**.
Não duplicamos campos à mão: a prosa de cada página só dá contexto e exemplos.

## Rodar localmente

Pré-requisito: Node 18+ (o site não usa o toolchain do monorepo).

```powershell
# Windows (PowerShell) — máquina de dev
npm i -g mintlify
cd docs/api-reference
mintlify dev
```

Abre em `http://localhost:3000`. `mintlify dev` faz hot-reload dos `.mdx` e do
`mint.json`.

Para validar links/estrutura antes de publicar:

```powershell
mintlify broken-links
```

## Publicar

O deploy é via app GitHub do Mintlify: conecte o repositório no dashboard do
Mintlify e aponte o **root da docs** para `docs/api-reference`. Cada push para a
branch padrão publica. (Alternativa CI: `mintlify` action no pipeline.)

## Fonte da verdade do contrato (importante)

A spec **autoritativa** é gerada em runtime pela API (F9), a partir dos schemas
Zod de validação, e servida em:

- `GET /api/v1/openapi.json` — JSON OpenAPI 3.1
- `GET /api/v1/docs` — Swagger UI

O arquivo `openapi/v1.json` deste site é um **snapshot fiel** dessa spec,
necessário porque o Mintlify lê a spec de um arquivo estático no build. Ele foi
transcrito 1:1 de `apps/api/src/routes/v1/openapi.ts` +
`apps/api/src/routes/v1/schemas.ts`.

### Como re-sincronizar o snapshot

Sempre que a API mudar o contrato v1, regenere o snapshot a partir da fonte da
verdade (com a API rodando localmente):

```powershell
# API local servindo a spec em /api/v1/openapi.json
curl http://localhost:4000/api/v1/openapi.json -o docs/api-reference/openapi/v1.json
```

Ajuste a porta para a da sua API local. Substitua o `servers[].url` do arquivo
pela URL pública (`https://api.highermind.com.br`) se necessário — o resto deve
bater com o runtime sem edição manual.

> Regra: **nunca** edite campos do contrato à mão neste site. Mude o schema Zod
> na API e re-exporte. O snapshot existe só para o build estático do Mintlify.

## Coerência com a F9 (onde cada coisa foi lida)

| Doc deste site                | Origem no código (F9)                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| Endpoints + schemas           | `apps/api/src/routes/v1/index.ts`, `.../v1/schemas.ts`, `.../v1/openapi.ts` |
| Auth (Bearer `hm_`) + scopes  | `apps/api/src/middlewares/api-key.ts`, `apps/api/src/services/api-keys.ts`, `API_SCOPES` em `.../v1/schemas.ts` |
| Ciclo de vida das chaves      | `apps/api/src/routes/dev/api-keys.ts`                             |
| Rate limit + headers + 429    | `apps/api/src/middlewares/api-key.ts`                            |
| Webhooks (HMAC, header, retry)| `apps/workers/src/webhooks/dispatcher.ts`, `.../webhooks/fanout.ts` |
| Gestão/eventos de webhook     | `apps/api/src/routes/dev/webhooks.ts` (`WEBHOOK_EVENTS`)         |
```
