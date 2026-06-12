---
id: F10-S09
title: Documentação da API pública — site de referência (Mintlify) sobre o OpenAPI v1
phase: F10
status: in-progress
priority: low
estimated_size: M
depends_on: []
agent_id: frontend-engineer
source_docs:
  - docs/ROADMAP.md#F10-S10
claimed_at: 2026-06-12T13:55:12Z

---
# F10-S09 — Site de documentação da API pública

> **source_docs:** `docs/ROADMAP.md` F10-S10
> **blocks:** —

## Objetivo

Site de referência da **API pública v1** (Mintlify, markdown-based — sem novo app no monorepo) que consome o OpenAPI 3.1 já gerado na F9 (`/api/v1/docs`) e adiciona guias de autenticação (API keys), webhooks (HMAC), rate limit e exemplos por endpoint.

## Contexto

A F9 já expõe Swagger interativo em runtime. Falta documentação **publicável/versionada** voltada a desenvolvedores externos. Mintlify lê markdown + `mint.json` + um OpenAPI spec — não exige novo workspace app (evita cirurgia no monorepo).

## Escopo (faz)

- `docs/api-reference/**`: estrutura Mintlify (`mint.json`, páginas de overview/auth/api-keys/webhooks/rate-limit, páginas por recurso geradas a partir do OpenAPI), snippet do spec OpenAPI (exportado do build da API ou referenciado).
- Guias: autenticação por API key (header), assinatura HMAC de webhooks (`X-HM-Signature`), paginação, erros, rate limit.
- README de como rodar/publicar (`mintlify dev`).

## Fora de escopo

- Novo app `apps/docs` / workspace (Mintlify é markdown — sem isso).
- Mudar a geração de OpenAPI na API (F9 já entrega).

## Arquivos permitidos

- `docs/api-reference/**`

## Arquivos proibidos

- `apps/**`, `packages/**`, raiz do monorepo (`package.json`, `pnpm-workspace.yaml`).

## Definition of Done

- [ ] `mintlify dev` renderiza o site com navegação completa; OpenAPI v1 consumido.
- [ ] Guias de auth (API key), webhooks (HMAC), rate limit e erros presentes com exemplos.
- [ ] Coerente com os endpoints reais da F9 (`send_message`/`send_template`/`upsert_contact`/`trigger_flow`/`conversations`).

## Validação

```bash
test -f docs/api-reference/mint.json
```

## Notas

- Especialista: **frontend-engineer** (ou general — é markdown/config).
- Fonte da verdade do contrato é o OpenAPI da F9; não duplicar à mão o que dá pra referenciar.
