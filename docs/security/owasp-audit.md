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
| A06 | Vulnerable & Outdated Components | **Follow-up** | `pnpm audit`: 3 high + 1 critical (ver seção). |
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

## A06 — Vulnerable & Outdated Components (FOLLOW-UP)

`pnpm audit` em 2026-06-12 (ver seção dedicada abaixo). **3 high + 1 critical**, todas
em dependências transitivas e/ou de dev — nenhuma introduzida por este slot. Bump fica
como follow-up dedicado (toca `package.json` de outros pacotes, fora da fronteira deste
slot).

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

## `pnpm audit` — 2026-06-12

Comando: `pnpm audit` (monorepo inteiro). Resultado:
`3 moderate | 3 high | 1 critical`.

| Severidade | Pacote | Versão | Patched | Caminho | Advisory |
|------------|--------|--------|---------|---------|----------|
| critical | `vitest` | <3.2.6 | >=3.2.6 | dev (`apps/*`, `packages/*`) | GHSA-5xrq-8626-4rwp — leitura/execução de arquivo via UI server (só com `--ui`, dev-only) |
| high | `drizzle-orm` | <0.45.2 | >=0.45.2 | runtime (`apps/api`, `apps/workers`, `packages/agents-core`) | GHSA-gpj5-g38j-94v9 — SQL injection via SQL identifier mal escapado |
| high | `@opentelemetry/sdk-node` | <0.217.0 | >=0.217.0 | runtime (`packages/logger`) | GHSA-q7rr-3cgh-j5r3 — crash do Prometheus exporter via HTTP malformado |
| high | `@opentelemetry/exporter-prometheus` | <0.217.0 | >=0.217.0 | runtime (`packages/logger`) | GHSA-q7rr-3cgh-j5r3 — mesmo CVE acima |

### Avaliação de risco

- **`vitest` (critical):** vulnerabilidade só explorável com o **UI server** do Vitest
  (`vitest --ui`), que **não** roda em CI nem em produção (`vitest run`). Risco efetivo
  em prod: **nenhum**. Mitigar com bump em slot de dependências.
- **`drizzle-orm` (high):** o vetor exige **SQL identifier dinâmico controlado por
  input**; o codebase usa identifiers estáticos (colunas do schema) — não passamos input
  de usuário como identifier. Risco efetivo: **baixo**. Bump recomendado (>=0.45.2).
- **`@opentelemetry/*` (high):** afeta o **Prometheus exporter** do OTel SDK. O `/metrics`
  da API usa **`prom-client`** (registry próprio), não o exporter do OTel SDK; o pipeline
  OTel é opt-in por env. Exposição depende de habilitar o exporter OTLP. Risco efetivo:
  **baixo–médio**. Bump recomendado (>=0.217.0).

### Follow-up obrigatório (slot de dependências dedicado)

Estes bumps tocam `package.json` de `apps/api`, `apps/workers`, `packages/agents-core` e
`packages/logger` — **fora da fronteira** de F10-S07 (que só permite `security.ts`,
`error.ts` e `docs/security/**`). Abrir slot:

```
- drizzle-orm     → >=0.45.2   (high, SQLi via identifier)
- vitest          → >=3.2.6    (critical, dev-only)
- @opentelemetry/* → >=0.217.0 (high, exporter Prometheus)
```

Nenhuma vulnerabilidade high/critical foi introduzida por este slot; todas são
transitivas/pré-existentes e estão documentadas acima com avaliação de risco.
