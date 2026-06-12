---
id: F10-S03
title: e2e Playwright — jornada completa (login → canal → msg → agente → flow → deal)
phase: F10
status: done
priority: medium
estimated_size: M
depends_on: []
agent_id: qa-engineer
source_docs:
  - docs/ROADMAP.md#F10-S03
claimed_at: 2026-06-12T14:14:46Z
completed_at: 2026-06-12T14:16:17Z

---
# F10-S03 — e2e Playwright (jornada completa)

> **source_docs:** `docs/ROADMAP.md` F10-S03
> **blocks:** —

## Objetivo

Suite Playwright que cobre a jornada crítica ponta-a-ponta no `@hm/web`: **login → conectar canal → enviar mensagem → resposta do agente → trigger de flow → mover deal no pipeline**, rodando headless e documentada.

## Contexto

Não há harness Playwright ainda. As features (F1–F9) estão completas; este slot dá a rede de segurança e2e antes de promover a clientes. Dependências externas (WAHA/agent-runtime) são **mockadas/stubadas** na borda para o teste ser determinístico.

## Escopo (faz)

- `apps/web/playwright.config.ts`: config (baseURL, projects, retries, trace on-failure, webServer opcional).
- `apps/web/e2e/**`: fixtures (auth storage state, seed/tenant), page objects mínimos, e o spec da jornada completa + specs menores por feature flagship.
- Mocks/route-interception para canais/agente quando o serviço real não estiver disponível.
- README curto de como rodar (`apps/web/e2e/README.md`).

## Fora de escopo

- Adicionar `@playwright/test` ao `package.json` (liste em Notas → orchestrator wire).
- CI workflow (follow-up F10 observability/CI).

## Arquivos permitidos

- `apps/web/e2e/**`
- `apps/web/playwright.config.ts`

## Arquivos proibidos

- `apps/web/package.json`, qualquer `apps/web/shared/**` ou `apps/web/features/**` (são de outros slots de frontend)

## Definition of Done

- [ ] `npx playwright test` roda a jornada completa headless e passa (com mocks determinísticos).
- [ ] Trace/screenshot on-failure habilitado; storage-state auth reaproveitado entre specs.
- [ ] README explica setup (deps + como subir o alvo).

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- Especialista: **qa-engineer**.
- Dep nova: `@playwright/test` (devDep de `@hm/web`) + `npx playwright install` — orchestrator adiciona no `package.json` no merge.
- Determinismo > cobertura: prefira interceptar rede a depender de WAHA/agent-runtime reais.
