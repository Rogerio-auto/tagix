---
id: F41-S02
title: Console "Try it" — Sandbox (mock) + Real (API key, GET-only)
phase: F41
status: review
priority: high
estimated_size: L
depends_on:
  - F41-S01
blocks:
  - F41-S03
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-19T16:04:09Z
completed_at: 2026-06-19T16:07:56Z

---
# F41-S02 — Console "Try it"

## Objetivo

Console de teste de requisições dentro do portal, com toggle **Sandbox (default) / Real**, respeitando os dois muros do "não misture" (SUPPORT.md §6.2/§6.3).

## Contexto

S01 entregou o model do OpenAPI com body/params/response + `buildExample`. O web fala com a API via proxy same-origin (`api-client`); CORS já libera `Authorization` da origem do web. API keys são geridas em Settings → Dev (só hash é guardado — o cliente cola a key raw no console).

## Escopo (faz)

- **`apps/web/features/developers/TryItConsole.tsx`** (novo) — por endpoint: form de request (path params, query, body pré-preenchido do exemplo do S01), botão executar, viewer de resposta (status, headers, body formatado), tempo de resposta.
- **Toggle de modo:**
  - **Sandbox (default):** gera resposta mock **client-side** a partir do response schema (S01). Vale para TODOS os endpoints (inclusive mutações). **NUNCA faz fetch de rede.** Badge/realce visual distinto ("Simulação — nenhum dado real tocado").
  - **Real:** input de **API key (Bearer)** mantida **só em estado de memória** (sem localStorage, sem persistir, sem logar). Executa via fetch `Authorization: Bearer <key>` contra `/api/v1`. **Somente endpoints GET.** Endpoint de escrita/efeito no modo real → desabilitado com aviso ("essa operação só roda no Sandbox para não disparar de verdade") e força Sandbox.
- **`apps/web/features/developers/ApiReference.tsx`** e/ou `DeveloperPortal.tsx` — montar o console no detalhe do endpoint (append ao que o S01 fez; não sobrescrever).
- Separação visual clara entre os dois modos (cor/badge), inequívoca.

## Fora de escopo

- Mudar a referência (S01). Backend. Persistir/gerir API keys (já existe em Settings → Dev — pode deep-linkar).

## Arquivos permitidos

- `apps/web/features/developers/TryItConsole.tsx`
- `apps/web/features/developers/ApiReference.tsx`
- `apps/web/features/developers/DeveloperPortal.tsx`
- `apps/web/features/developers/openapi.ts`
- `apps/web/features/developers/index.ts`

## Arquivos proibidos

- `apps/api/**`, `packages/**`, demais features

## Definition of Done

- [ ] Sandbox gera resposta mock do schema, para qualquer endpoint, SEM nenhuma request de rede.
- [ ] Real executa só GET com a API key colada; mutações bloqueadas no real (forçam Sandbox com aviso).
- [ ] API key vive só em memória (sem localStorage/sessionStorage, sem log); some ao sair.
- [ ] Separação visual Sandbox vs Real inequívoca; DS v2 tokens; estados loading/error/empty; ARIA.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

GET-only no modo real é UX de segurança (a API em si segue protegida por scope/RLS). O muro que importa: Sandbox jamais emite fetch; modo real jamais executa mutação. Determinar GET vs mutação pelo método do endpoint (do model do S01).
</content>
