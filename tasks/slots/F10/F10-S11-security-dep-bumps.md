---
id: F10-S11
title: Bump de dependências vulneráveis (OWASP A06) — drizzle-orm, OTel, vitest
phase: F10
status: available
priority: high
estimated_size: M
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/security/owasp-audit.md
  - docs/ROADMAP.md#F10-S08
---

# F10-S11 — Bump de dependências vulneráveis

> **source_docs:** `docs/security/owasp-audit.md` (A06); follow-up do F10-S07
> **blocks:** —

## Objetivo

Fechar os achados de `pnpm audit` do F10-S07 (OWASP A06 — componentes vulneráveis): bump das deps com vuln **high/critical** para versões corrigidas, mantendo todas as suites de teste verdes. Onde o bump for inviável/excessivamente invasivo, documentar **accept-risk** justificado em `docs/security/owasp-audit.md`.

## Contexto

`pnpm audit` (2026-06-12) reportou: `drizzle-orm <0.45.2` (high, SQLi via identifier dinâmico — hoje `^0.38.3`), `@opentelemetry/sdk-node`/`exporter-prometheus <0.217.0` (high), `vitest <3.2.6` (critical, **só explorável com `--ui`**, que não roda em CI/prod). Todas transitivas/pré-existentes. O codebase usa identifiers estáticos no Drizzle e `prom-client` próprio (não o exporter OTel), então o risco efetivo é baixo — mas o follow-up é fechar o audit.

## Escopo (faz)

- Bump `drizzle-orm` → `>=0.45.2` em `packages/db` (e onde mais constar); rodar migrations/tests do `@hm/db` para garantir compat.
- Bump `@opentelemetry/*` (sdk-node + exporters) → linha corrigida em `packages/logger`.
- **vitest**: bump para a linha corrigida (`>=3.2.6`) nos pacotes que usam vitest, OU — se o major 2→3 quebrar suites de forma desproporcional — manter 2.x e documentar accept-risk (o vetor `--ui` nunca roda em CI/prod). Decisão é sua, com justificativa no audit.
- Regenerar `pnpm-lock.yaml` (`pnpm install`) e ajustar qualquer breaking change mínimo de API/config de teste.
- Atualizar `docs/security/owasp-audit.md` (seção A06) com o estado final de cada CVE.

## Fora de escopo

- Qualquer dep de `apps/web` (território F10-S13/S10).
- Mudanças de comportamento de produto.

## Arquivos permitidos

- `packages/*/package.json` (exceto nenhum — todos os packages)
- `apps/api/package.json`, `apps/workers/package.json`
- `package.json` (root, se pinnar vitest)
- `packages/*/vitest.config.ts`, `apps/api/vitest.config.ts` (migração v3, se aplicável)
- `pnpm-lock.yaml`
- `docs/security/owasp-audit.md`
- Ajustes mínimos em arquivos `*.test.ts` que quebrem por API de teste (documentar cada um)

## Arquivos proibidos

- `apps/web/**` (F10-S10/S12/S13)
- Código de produção não-teste (exceto adaptações forçadas por breaking change, documentadas)

## Definition of Done

- [ ] `pnpm audit` sem **high/critical** restante — OU cada remanescente com accept-risk justificado em `owasp-audit.md`.
- [ ] `pnpm typecheck` + `pnpm lint` verdes; **todas** as suites de teste do monorepo verdes (db/api/workers/logger/ui/channels/flow-engine/storage/agents-*).
- [ ] `pnpm-lock.yaml` regenerado e consistente.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm -r --if-present test
pnpm audit
```

## Notas

- Especialista: **backend-engineer**.
- **EXCEÇÃO ao protocolo:** este slot PODE rodar `pnpm install` (regenerar lock é o ponto). NÃO rode git/slot.py mesmo assim.
- Priorize: drizzle-orm e OTel (bumps menores/contidos) primeiro; vitest por último (maior blast radius). Se vitest 3 quebrar muito, accept-risk é resposta world-class aceitável aqui (vetor `--ui` fora de CI/prod) — documente.
