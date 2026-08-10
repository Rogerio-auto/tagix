---
id: F57-S02
title: e2e determinístico — fechar o proxy SSR do Next (ECONNREFUSED :3001)
phase: F57
status: available
priority: critical
estimated_size: S
depends_on: []
blocks: []
agent_id: frontend-engineer
source_docs:
  - .github/workflows/ci.yml
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S02 — e2e determinístico: o proxy SSR não está mockado

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). O job `e2e` falha no
> `main` (run `29623760575`, step `Run e2e (mocked)`).

## Objetivo

Fazer a suíte Playwright passar sem nenhum serviço de backend de pé, como o job
já promete no comentário.

## Contexto / causa raiz (verificada)

`.github/workflows/ci.yml:112-115` afirma:

> *"Determinístico — toda a rede que sai do browser é interceptada nas fixtures
> (nenhum serviço real precisa estar de pé)."*

A afirmação é **falsa para o caminho SSR**. O log do run mostra, em série:

```
[WebServer] Failed to proxy http://localhost:3001/api/me        [ECONNREFUSED]
[WebServer] Failed to proxy http://localhost:3001/api/conversations
[WebServer] Failed to proxy http://localhost:3001/api/flows
[WebServer] Failed to proxy http://localhost:3001/api/departments
[WebServer] Failed to proxy http://localhost:3001/api/teams
… (e outros)
```

As fixtures interceptam requisições **do browser** (`page.route`), mas os rewrites
de `/api`, `/auth` e `/socket.io` são resolvidos **no servidor Next** (`next dev`
subido pelo `webServer` do Playwright) contra `API_PROXY_TARGET` →
`http://localhost:3001`, onde não há API. Todo componente que busca dados em RSC /
server action escapa da rede de mock.

## Escopo (faz)

Escolher **uma** estratégia e aplicá-la de forma consistente:

- **(a) preferida)** apontar `API_PROXY_TARGET` no job `e2e` para um stub HTTP
  local, subido junto do `webServer`, que responde as rotas usadas pelos specs; ou
- **(b)** garantir que todo spec exercite apenas caminhos client-side, e fazer o
  proxy SSR falhar **alto** (não silencioso) para que o vazamento apareça como erro
  de teste e não como log.

Em qualquer caso: corrigir o comentário do workflow para descrever o que de fato
acontece.

## Escopo (não faz)

- Falhas do job `ci` (env + catálogo de planos) → **F57-S01**.
- Novos cenários de e2e. Este slot **estabiliza** o que existe.

## Arquivos permitidos

- `.github/workflows/ci.yml`
- `apps/web/playwright.config.ts`
- `apps/web/e2e/**`
- `apps/web/next.config.ts`

## Arquivos proibidos

- `apps/web/app/**`
- `apps/web/features/**`

## Definition of Done

- [ ] `pnpm --filter @hm/web exec playwright test` passa com **nenhum** serviço de
      backend rodando (validado em máquina limpa).
- [ ] Zero linha `Failed to proxy` no output do `webServer`.
- [ ] O comentário do job `e2e` descreve a estratégia real de isolamento.
- [ ] Job `e2e` verde no `main`.

## Validação

```bash
pnpm --filter @hm/web exec playwright test
```

## Notas

- `API_PROXY_TARGET` é lido em **build-time** pelo Next (congela os rewrites no
  `routes-manifest`) — ver o comentário em `apps/web/Dockerfile`. No `next dev` do
  Playwright vale o valor do processo, mas a assimetria build/runtime é armadilha
  conhecida: documente qual dos dois o e2e usa.
