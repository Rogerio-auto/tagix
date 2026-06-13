# OWASP Top 10 — Auditoria de segurança da @hm/api

> Slot: **F10-S07** — Security hardening (OWASP top 10)
> Data: 2026-06-12
> Escopo: borda HTTP da `@hm/api` (Express 5). Auth de sessão, api-key (F9-S02) e
> RLS no Postgres já existem e **não** são recriados aqui — esta auditoria
> endurece **headers**, **CORS** e **sanitização de erro**, e registra o estado
> item-a-item do top 10 com follow-ups.

## Resumo executivo

| # | Categoria (OWASP 2021) | Status | Notas |
|---|------------------------|--------|-------|
| A01 | Broken Access Control | OK + follow-up | RLS multi-tenant + `requireRole`/`can()`; CORS allowlist estrita adicionada. |
| A02 | Cryptographic Failures | OK + follow-up | HSTS em prod; segredos só em `.env`; TLS é responsabilidade do edge/reverse-proxy. |
| A03 | Injection | OK | Drizzle parametrizado + Zod em toda input externa. Ver follow-up de versão (audit). |
| A04 | Insecure Design | OK | Fail-fast no config; deny-by-default em CORS/CSP. |
| A05 | Security Misconfiguration | **Endurecido neste slot** | helmet/CSP/HSTS/no-sniff/frame-guard + erro sanitizado. |
| A06 | Vulnerable & Outdated Components | **Resolvido (F10-S11)** | `pnpm audit`: 0 high/critical. Restam 2 moderate transitivos com accept-risk (ver seção). |
| A07 | Identification & Authentication Failures | OK | Sessão + api-key com escopo; fora do escopo deste slot. |
| A08 | Software & Data Integrity Failures | OK | Webhooks Meta com HMAC + dedup (`webhook_events`). |
| A09 | Security Logging & Monitoring Failures | **Endurecido neste slot** | Correlation id (`hm_err_*`) + log estruturado; Sentry/OTel opt-in. |
| A10 | Server-Side Request Forgery (SSRF) | OK + follow-up | Sem fetch de URL controlada por usuário na borda; revisar adapters de canal. |

---

## A01 — Broken Access Control

- **Existente:** RLS por workspace no Postgres (escopo via `withWorkspace`/`req.scoped`),
  middlewares `requireAuth`/`withRLS`/`requireRole(perm)` com matriz `ROLE_CAN`
  (`can(role, perm)` de `@hm/shared`). Roles: OWNER/ADMIN/SUPERVISOR/AGENT/READONLY.
- **Adicionado (S07):** CORS **allowlist estrita** por env — `Access-Control-Allow-Origin`
  só é ecoado para origens na lista (`CORS_ORIGIN`, CSV). Sem `*`, sem reflexão cega de
  `Origin`. `credentials: true` mantido (cookies de sessão) — seguro porque a origem é
  validada antes de permitir credenciais.
- **Follow-up:** auditoria de IDOR rota-a-rota (coerção `req.params['id']`) é coberta por
  RLS no banco, mas merece um slot de teste de penetração dedicado.

## A02 — Cryptographic Failures

- **HSTS** ativado em produção: `max-age=31536000; includeSubDomains; preload`
  (desligado fora de prod — TLS local raramente existe). Força HTTPS no browser.
- **`upgrade-insecure-requests`** na CSP.
- Segredos só em `.env` (nunca commitado); `@hm/logger` redige `authorization`,
  `token`, `secret`, `apiKey`, `password`, `phone`, `email`.
- **Follow-up:** TLS termination/cert é responsabilidade do reverse-proxy de produção
  (Nginx/Caddy na VPS) — documentar no runbook de deploy.

## A03 — Injection

- **SQL:** acesso a dados só via `@hm/db` (Drizzle, queries parametrizadas) — nunca
  string-concat de SQL. RLS escopa por workspace.
- **Input externa:** validação Zod em todo body/query/params de borda.
- **XSS refletido:** a API responde JSON (`Content-Type: application/json`), `noSniff`
  impede o browser de reinterpretar como HTML; CSP `script-src 'self'`.
- **Follow-up (A06):** advisory de SQL-injection do `drizzle-orm` por identifier mal
  escapado — ver seção de componentes (não usamos identifiers dinâmicos de input, baixo
  risco, mas atualizar a versão).

## A04 — Insecure Design

- `loadConfig()` é **fail-fast** (não sobe sem `DATABASE_URL`/`REDIS_URL`).
- CORS e CSP são **deny-by-default**: origem desconhecida não recebe o header; CSP
  `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`.

## A05 — Security Misconfiguration (ENDURECIDO NESTE SLOT)

`apps/api/src/middlewares/security.ts` consolida (antes `helmet()`/`cors()` inline):

- **CSP explícita** (`useDefaults: false`): `default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`, `frame-src 'none'`, `script-src 'self'`,
  `connect-src 'self' + allowlist CORS + CSP_CONNECT_SRC`, sem `unsafe-eval`.
  `style-src` permite `'unsafe-inline'` apenas para o Swagger UI em `/api/v1/docs`.
- **HSTS** (prod), **`X-Content-Type-Options: nosniff`**, **frame-guard `DENY`**,
  **`Referrer-Policy: no-referrer`**, **COOP/CORP** restritivos, **`x-powered-by`** off.
- **CORS allowlist** estrita por env + métodos/headers/preflight explícitos.
- **Erro sanitizado** (`middlewares/error.ts`): em produção a resposta é apenas
  `{ message: "Erro interno. Tente novamente.", ref }` — **zero stack, SQL, path ou
  mensagem crua**. Dev/test anexam `detail` + `stack` para debug. Detalhe completo só
  nos logs server-side, sob o `ref`.

## A06 — Vulnerable & Outdated Components (RESOLVIDO EM F10-S11)

O follow-up de F10-S07 foi executado em **F10-S11**: bump das deps com vuln
**high/critical** para as linhas corrigidas, regeneração do `pnpm-lock.yaml` e todas as
suites de teste do monorepo verdes. Estado final: `pnpm audit` reporta **0 high/critical**
(restam 2 moderate transitivos com accept-risk justificado — ver seção dedicada abaixo).

## A07 — Identification & Authentication Failures

- Auth de sessão (Supabase atrás de `IAuthProvider`) + api-key com escopo (F9-S02).
- Fora do escopo deste slot; sem alteração.

## A08 — Software & Data Integrity Failures

- Webhooks Meta validados por **HMAC** + dedup idempotente (`webhook_events`).
- Sem deserialização insegura (JSON apenas; `express.json({ limit: '1mb' })` limita
  payload — anti DoS de corpo).

## A09 — Security Logging & Monitoring Failures (ENDURECIDO NESTE SLOT)

- **Correlation id** sempre presente: `hm_err_*` no corpo de erro e no header
  `X-Error-Ref` — rastreável do cliente ao log.
- Log de erro **estruturado** (`{ level, ref, status, message, stack }`) server-side.
- Sentry (`SENTRY_DSN_API`) e OTel (`@hm/logger`) opt-in por env.
- **Follow-up:** centralizar logs com alerta em taxa de 5xx (observability, F10-S01).

## A10 — Server-Side Request Forgery (SSRF)

- A borda HTTP não faz fetch de URL controlada por input de usuário.
- **Follow-up:** revisar `@hm/channels` (GraphClient) e webhooks de saída (F9) para
  garantir allowlist de host/egress — fora da fronteira deste slot.

---

## `pnpm audit` — baseline F10-S07 → fechamento F10-S11

### Baseline (2026-06-12, ao iniciar F10-S11)

`pnpm audit` (monorepo inteiro): `3 moderate | 5 high | 2 critical`. O lockfile derivou
desde o registro original de F10-S07 (que listava `3 moderate | 3 high | 1 critical`),
trazendo achados novos em `happy-dom` e `esbuild`/`vite` (transitivos de `vitest`).

| Severidade | Pacote | Versão | Patched | Caminho | Advisory |
|------------|--------|--------|---------|---------|----------|
| critical | `vitest` | <3.2.6 | >=3.2.6 | dev (`apps/*`, `packages/*`) | GHSA-5xrq-8626-4rwp — leitura/execução de arquivo via UI server (só com `--ui`, dev-only) |
| critical | `happy-dom` | <20.0.0 | >=20.0.0 | dev (transitivo de `vitest`; direto em `@hm/ui`) | GHSA-37j7-fg3j-429f — VM context escape → RCE |
| high | `drizzle-orm` | <0.45.2 | >=0.45.2 | runtime (`apps/api`, `apps/workers`, `packages/agents-core`, `packages/db`, `packages/flow-engine`) | GHSA-gpj5-g38j-94v9 — SQL injection via SQL identifier mal escapado |
| high | `happy-dom` | <20.8.9 | >=20.8.9 | dev (idem acima) | GHSA-w4gp-fjgq-3q4g — fetch usa cookies de page-origin |
| high | `happy-dom` | >=15.10.0 <=20.8.7 | >=20.8.8 | dev (idem acima) | GHSA-6q6h-j7hj-3r64 — export names interpolados como código executável |
| high | `@opentelemetry/sdk-node` (exporter-prometheus transitivo) | <0.217.0 | >=0.217.0 | runtime (`packages/logger`) | GHSA-q7rr-3cgh-j5r3 — crash do Prometheus exporter via HTTP malformado |
| moderate | `vite` | <=6.4.1 | >=6.4.2 | dev (transitivo de `vitest`) | GHSA-4w7w-66w2-5vf9 — path traversal em optimized deps |
| moderate | `esbuild` | <=0.24.2 | >=0.24.3 | dev (transitivo de `vitest` e de `drizzle-kit`) | GHSA-67mh-4wv8-2f99 — dev-server aceita requests de qualquer origem |
| moderate | `postcss` | <8.5.10 | >=8.5.10 | dev (`apps/web>next`) | GHSA-qx2v-qp2m-jg93 — XSS via `</style>` não escapado |

### Bumps aplicados (F10-S11)

| Dep | De | Para | Pacotes tocados |
|-----|----|----|-----------------|
| `drizzle-orm` | `^0.38.3` | `^0.45.2` | `@hm/db`, `@hm/api`, `@hm/workers`, `@hm/agents-core`, `@hm/flow-engine` |
| `vitest` | `^2.1.8` / `^3.0.5` | `^3.2.6` | `@hm/api`, `@hm/workers`, `@hm/db`, `@hm/agents-core`, `@hm/flow-engine`, `@hm/storage`, `@hm/ui`, `@hm/agents-client`, `@hm/channels` |
| `@opentelemetry/sdk-node` | `^0.57.0` | `^0.219.0` | `@hm/logger` |
| `@opentelemetry/exporter-trace-otlp-http` | `^0.57.0` | `^0.219.0` | `@hm/logger` |
| `@opentelemetry/exporter-metrics-otlp-http` | `^0.57.0` | `^0.219.0` | `@hm/logger` |
| `@opentelemetry/sdk-metrics` | `^1.30.0` | `^2.8.0` | `@hm/logger` |
| `happy-dom` | `^15.11.7` | `^20.10.2` | `@hm/ui` |

- **drizzle-orm → 0.45.2:** sem breaking change observável no código. Suites do `@hm/db`
  (RLS multi-tenant + crypto) e de todos os consumidores (api/workers/agents-core/
  flow-engine) verdes. Typecheck verde. O vetor exigia identifier dinâmico de input — o
  codebase usa identifiers estáticos (já era baixo risco), agora fechado de toda forma.
- **vitest 2 → 3 (3.2.6):** **sem accept-risk** — o major 2→3 do Vitest **não** quebrou
  nenhuma suite. Dois pacotes (`@hm/channels`, `@hm/agents-client`) já rodavam v3; os
  `vitest.config.ts` existentes (apenas `include`/`setupFiles`/`fileParallelism`/
  `environment`/`globals`) são compatíveis com v3 sem migração. Nenhum `*.test.ts` precisou
  de ajuste. Toda a suite do monorepo verde em v3.2.6 (525 testes). O bump também substitui
  o `vite`/`esbuild` transitivos por versões patched, fechando 2 moderates de borda.
- **@opentelemetry/* → 0.219.0 + sdk-metrics 2.8.0:** o `sdk-node@0.219.0` depende de
  `sdk-metrics@2.x` (a linha estável passou de 1.x para 2.x), então o conjunto foi
  promovido coerentemente. `@opentelemetry/api` (`^1.9.0`) continua compatível
  (peer `^1.3.0`). O `otel.ts` (NodeSDK + OTLP trace/metric exporters +
  PeriodicExportingMetricReader) **não** sofreu breaking change de API: typecheck verde
  sem tocar código de produção. O `/metrics` da API segue usando `prom-client` próprio,
  não o exporter Prometheus do OTel.
- **happy-dom → 20.10.2:** dep direta do `@hm/ui` (DOM emulado p/ testes de a11y) e
  transitiva do `vitest`. Suite `@hm/ui` (`a11y.test.tsx`) verde no novo major.

### Estado final (`pnpm audit`, pós-bump)

`pnpm audit`: **`2 moderate`** — **0 high / 0 critical**. Todos os CVEs high/critical do
baseline foram fechados (drizzle-orm, vitest, happy-dom, OTel/exporter-prometheus, além
de vite moderate).

### Accept-risk (2 moderate remanescentes)

| Severidade | Pacote | Caminho | Justificativa |
|------------|--------|---------|---------------|
| moderate | `esbuild` <=0.24.2 | `packages/db > drizzle-kit > @esbuild-kit/* > esbuild` (e `drizzle-kit > esbuild`) | `drizzle-kit@0.30.6` fixa um `esbuild` antigo na sua cadeia. É **ferramenta de migração dev-only** (`generate`/`migrate`), **nunca** empacotada no runtime de produção e nunca expõe dev-server em CI/prod. O vetor exige rodar o dev-server do esbuild localmente. Bumpar `drizzle-kit` para uma linha que carregue esbuild patched está fora dos CVEs-alvo deste slot e arrisca o pipeline de migrations; deferido. O esbuild do `vitest` já é >=0.25 (patched). |
| moderate | `postcss` <8.5.10 | `apps/web > next > postcss` | Transitivo de `next` em **`apps/web`** — território **proibido** para este slot (F10-S10/S12/S13). Fecha junto com o bump de `next`. Build-time/dev-only do front; sem exposição de runtime de produto. |

Nenhuma vulnerabilidade high/critical permanece. Os 2 moderates remanescentes são
transitivos, dev/build-time apenas, e fora da fronteira deste slot (drizzle-kit / apps/web).

### Atualização pós-F15 (2026-06-13) — novo high `esbuild` (accept-risk)

`pnpm audit` passou a reportar **`1 low | 3 moderate | 1 high`**. A F15 (Instagram) **não
alterou nenhuma dependência** (`git diff f875305..HEAD` em todo `package.json`/lockfile =
vazio) — o `high` é uma **advisory recém-publicada** sobre um dev-dep pré-existente.

| Severidade | Pacote | Caminho | Decisão |
|------------|--------|---------|---------|
| **high** | `esbuild` >=0.17.0 <0.28.1 (GHSA-gv7w-rqvm-qjhr — "Missing binary integrity verification in **Deno**") | `apps/api > tsx > esbuild`; `apps/api > vitest > vite > esbuild` (72 paths) | **Accept-risk.** (1) A advisory é **específica de Deno** — o projeto roda **Node**, o vetor não se aplica. (2) `esbuild` é **dev/build-time only** (tsx/vitest/vite) — nunca no bundle de runtime de produção. (3) Patched só em `>=0.28.1`, incompatível com `vite@6`/`vitest@3` (que fixam `esbuild ^0.24`); um override **quebraria toda a toolchain de build/test**. Forçar seria temerário por um achado inaplicável ao ambiente. Reavaliar quando vite/vitest subirem o range de esbuild. |

Estado aceito pós-F15: **0 high/critical *aplicáveis ao runtime de produção*** — o único
high é dev-tooling Deno-specific. Os demais moderates/low seguem a justificativa acima.
