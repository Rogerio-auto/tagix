---
id: F38-S13
title: Portal do Desenvolvedor in-product (DS v2, render do OpenAPI)
phase: F38
status: done
priority: high
estimated_size: L
depends_on:
  - F38-S12
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T17:34:04Z
completed_at: 2026-06-18T17:41:36Z

---
# F38-S13 — Portal do Desenvolvedor

## Objetivo

Documentação de API in-product, DS v2 (não Swagger cru): Getting Started, Autenticação, Referência (renderizada do `/api/v1/docs` JSON), Webhooks e Exemplos copy-paste (curl/JS/Python). Lê o OpenAPI já incluindo os endpoints novos do S12.

## Contexto

OpenAPI servido em `/api/v1/docs` (JSON + Swagger). Settings → Dev já gere API keys + webhooks (`apps/web/features/settings/sections/dev/*`). DS v2, responsivo. O portal vive sob `/help/developers` (descoberta a partir da Central de Ajuda) e pode ser linkado da seção Dev.

## Escopo (faz)

- **`apps/web/app/(app)/help/developers/page.tsx`** (novo) — rota do portal.
- **`apps/web/features/developers/**`** (novo) — layout com seções (Getting Started, Autenticação, Referência, Webhooks, Exemplos); componente que **busca o OpenAPI JSON** e renderiza a referência agrupada por recurso (método, path, params, request/response, scope); blocos de código copy-paste (curl/JS/Python) com troca de linguagem; deep-link para Settings → Dev (criar API key). Estados loading/error.
- **Link de descoberta** — adicionar entrada "Desenvolvedores / API" no `DevSection` (`apps/web/features/settings/sections/dev/DevSection.tsx`) apontando pro portal. Tocar só o ponto do link.

## Fora de escopo

- Endpoints/spec backend (S12). Gestão de API keys/webhooks (já existe). Substituir o Swagger (mantém como fallback).

## Arquivos permitidos

- `apps/web/app/(app)/help/developers/**`
- `apps/web/features/developers/**`
- `apps/web/features/settings/sections/dev/DevSection.tsx`

## Arquivos proibidos

- `apps/api/**`, `packages/db/**`

## Definition of Done

- [ ] Referência renderiza a partir do OpenAPI live (inclui endpoints do S12); agrupada por recurso com scopes.
- [ ] Getting Started + Autenticação + Webhooks + Exemplos (curl/JS/Python) copy-paste funcionam.
- [ ] DS v2 tokens; responsivo; estados; branding "Leadium API".
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Notas

Render da referência a partir do JSON do OpenAPI (uma fonte só — não duplicar a doc à mão). Se precisar de lib de syntax-highlight, escolher leve e tree-shakeable.
</content>
