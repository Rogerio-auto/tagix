---
id: F70-S29
title: e2e do CI verde de novo (gate do deploy)
phase: F70
status: in-progress
priority: critical
estimated_size: M
depends_on: [F70-S28]
blocks: []
source_docs:
  - .github/workflows/ci.yml
  - apps/web/playwright.config.ts
agent_id: backend-engineer
claimed_at: 2026-09-25T20:32:15Z

---
# F70-S29 — e2e do CI verde de novo

## Objetivo

O job `e2e` do CI voltar a passar. Sem ele verde, o `deploy` é pulado e nada chega à produção pelo pipeline.

## Contexto

- Os três últimos runs de `main` falharam no `e2e`, com `deploy: skipped`. São eles o 36139216518 (hotfix `d774835a`, 25/09), o 35783672961 (`9a9005ac`, 22/09) e o 35756497740 (`faadb93b`, 22/09). A produção está em `9a9005ac`, provavelmente por deploy manual.
- Falham quase todos os specs: `auth.spec` (redirect para o login, login válido, credenciais inválidas), `channels.spec`, `calendar-v2.spec`, `agent-department-routing.spec`. Passam os que não dependem de dados mockados (validação client-side, estado vazio).
- No log do webServer aparecem `Failed to proxy http://localhost:3001/... ECONNREFUSED` e `SyntaxError: Unexpected end of JSON input`. A suspeita é que os specs mockam a API por `page.route` no navegador, mas parte das chamadas sai do servidor Next (proxy/rewrite para `API_PROXY_TARGET`, middleware, RSC), onde o mock não alcança.
- A F70-S28 mudou o middleware: ele agora consulta `/api/me` no servidor. Também mudou o `playwright.config.ts` (API de sessão falsa na porta 3199) e acrescentou `e2e/specs/session-expired.spec.ts`. Precisa passar junto.
- A S28 também apontou que `auth.spec` "credenciais inválidas" espera um texto que o `LoginForm` não mostra.

## Escopo

### files_allowed

- `apps/web/e2e/**`
- `apps/web/playwright.config.ts`
- `.github/workflows/ci.yml` *(só o job `e2e`)*
- `apps/web/next.config.mjs` *(só se o proxy de dev precisar de ajuste para o e2e, sem mudar produção)*

## Escopo (faz)

- Diagnosticar com os logs do CI (`gh run view <id> --log-failed`) e reproduzir localmente o menor conjunto possível.
- Um servidor de API falsa único para o e2e, que atenda tanto as chamadas feitas pelo servidor Next (middleware, rewrites, RSC) quanto as feitas pelo navegador, ou uma estratégia equivalente e determinística. Nada de depender de API real.
- Corrigir specs desatualizados em relação à UI atual, sem afrouxar o que eles provam.
- Nenhum `test.skip` sem justificativa escrita no slot.

## Definition of Done

- [ ] todos os specs passam localmente (ou, se a RAM não deixar, um lote representativo, mais a prova no CI de uma branch)
- [ ] causa raiz documentada no slot
- [ ] nenhum teste desativado sem justificativa
