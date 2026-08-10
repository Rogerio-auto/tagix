---
id: F57-S03
title: Supply chain — zerar HIGH do pnpm audit e travar o gate no CI
phase: F57
status: available
priority: critical
estimated_size: M
depends_on: [F57-S01]
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/security/owasp-audit.md
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S03 — Zerar as 27 HIGH do `pnpm audit` + gate permanente no CI

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). `pnpm audit` no HEAD
> `53b6364e`: **27 high · 12 moderate · 2 low · 0 critical**. O padrão Higher Mind é
> explícito: *"Zero vulnerabilidades conhecidas de severidade HIGH ou CRITICAL"*.
> Não há step de audit no CI — por isso a dívida acumulou em silêncio.

## Objetivo

Zerar HIGH/CRITICAL e impedir regressão por gate de CI.

## Contexto / causa raiz (verificada)

Nenhum job do `.github/workflows/ci.yml` roda `pnpm audit`. O `pnpm-workspace.yaml`
já tem o mecanismo certo (`overrides:` — usado para `rollup >=3.30.0` no F10-S13);
está só subutilizado.

### Tier 1 — exposto a tráfego de tenant (corrigir primeiro)

| Pacote | Instalado | Mínimo seguro | Por que importa **aqui** |
|---|---|---|---|
| `next` | 15.5.19 | **15.5.21** | SSRF em **rewrites via hostname de destino controlado pelo atacante** — e o `apps/web` roteia `/api`, `/auth` e `/socket.io` exatamente por rewrite (`API_PROXY_TARGET`). Também: SSRF em Server Actions em custom server (roda `node server.js` standalone), DoS no App Router, divulgação de endpoints internos de Server Function |
| `socket.io-parser` | 4.2.6 | **4.2.7** | Memory exhaustion com zero attachments. O Socket.io está **publicamente exposto** pelo Traefik em `app.leadium.com.br/socket.io` |
| `ws` | 8.20.1 | **8.21.0** | Memory exhaustion DoS por fragmentos minúsculos — mesmo caminho de WebSocket |
| `sharp` | 0.34.5 | **0.35.0** | CVEs herdadas do libvips (CVE-2026-33327/33328/35590/35591). O `sharp` processa **mídia enviada por tenant** |
| `form-data` | 4.0.5 | **4.0.6** | CRLF injection em nomes de campo/arquivo multipart |
| `fast-uri` | ≤3.1.3 | **3.1.5** | Host confusion via `\` como introdutor de authority — usado na validação de URL |

### Tier 2 — build-time / transitivo (fechar via `overrides`)

`postcss` (path traversal + leitura arbitrária de `.map` via `sourceMappingURL`),
`brace-expansion` (várias DoS, inclui bypass da mitigação de CVE-2026-14257),
`js-yaml` (CPU quadrático em `!!omap` e merge-keys), `nanoid` (loop infinito),
`shell-quote` (DoS quadrático em `parse()`), `esbuild` (dev server lê respostas
arbitrárias), `protobufjs`, `uuid`, `@opentelemetry/core`,
`@opentelemetry/propagator-jaeger`.

## Escopo (faz)

- Subir as diretas (`next`, `sharp`, `socket.io`, `express` se necessário) nos
  `package.json` correspondentes.
- Fechar as transitivas com `overrides:` no `pnpm-workspace.yaml`, cada entrada com
  comentário citando o GHSA/CVE — mesmo padrão do override de `rollup` já existente.
- Adicionar step no job `ci`, **depois** do install:
  `pnpm audit --audit-level high` (falha o build).
- Rodar `uv run pip-audit` (ou equivalente) no job `python` e corrigir o que houver
  em `apps/agent-runtime`.

## Escopo (não faz)

- Upgrades de major que mudem API (ex.: Next 16). Só a linha corrigida mínima.
- Pin de actions do GitHub → **F57-S04**.

## Arquivos permitidos

- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `package.json`
- `apps/*/package.json`
- `packages/*/package.json`
- `apps/agent-runtime/pyproject.toml`
- `apps/agent-runtime/uv.lock`
- `.github/workflows/ci.yml`
- `docs/security/owasp-audit.md`

## Arquivos proibidos

- `apps/*/src/**`, `packages/*/src/**` (se um bump exigir mudança de código-fonte,
  **pare** e abra sub-slot — não misture upgrade com refactor)

## Definition of Done

- [ ] `pnpm audit --audit-level high` sai **0**.
- [ ] `pnpm audit` reporta `high: 0, critical: 0`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm -r build`, `pnpm -r test` todos verdes
      **após** os bumps.
- [ ] Step de audit presente no job `ci` e falhando de verdade (validar com um
      override temporário que reintroduza vulnerabilidade).
- [ ] `docs/security/owasp-audit.md` atualizado com data, versões e GHSAs fechados.

## Validação

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm typecheck
pnpm lint
pnpm -r --if-present build
pnpm -r --if-present test
```

## Notas

- Ordem sugerida: Tier 1 primeiro (um commit por pacote, cada um com build+test
  verdes), Tier 2 num commit de `overrides`. Assim um bump que quebrar é isolável.
- `depends_on: F57-S01` é deliberado: sem CI verde não há como saber se um bump
  quebrou algo.
