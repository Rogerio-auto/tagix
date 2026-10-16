---
id: F75-S16
title: SSRF guard no port HTTP do flow-engine (nó http_request)
phase: F75
status: review
priority: critical
estimated_size: S
model: opus
depends_on: []
blocks: [F75-S13]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-10-16T22:47:25Z
completed_at: 2026-10-16T23:26:41Z

---
# F75-S16 — SSRF no port HTTP do flow-engine

## Objetivo

O nó `http_request` dos Flows deixa de poder alcançar a rede interna, metadados de nuvem ou qualquer IP privado:
toda chamada passa pelo mesmo guard dos webhooks de saída e das integrações.

## Contexto

Achado da verificação de código de 16/10 (spec §14): `packages/flow-engine/src/ports/http.port.ts`
(`flowHttpPort`, port padrão exportado em `packages/flow-engine/src/index.ts` e usado pelos workers) chama
`fetch` direto, apesar do comentário do handler dizer que o SSRF é tratado no port. Um admin de empresa que monta
um flow consegue fazer o servidor chamar `http://169.254.169.254/` ou serviços internos. Independente do resto da
F75; entra antes da auditoria (S13), que vai revisar todos os caminhos de saída HTTP.

## Escopo (faz)

- `flowHttpPort` passa a usar `ssrfSafeFetch` + `createGuardedLookup` de `@hm/shared/net`: só `http(s)`, sem
  credenciais na URL, IP privado/loopback/link-local/metadados bloqueados (inclusive por DNS e por redirect),
  allowlist de dev por `httpAllowlistFromEnv()`.
- Teto de resposta: manter o comportamento do handler (corpo lido até o limite que o handler já usa; se o
  `ssrfSafeFetch` corta em 64 KiB e o handler precisa de mais, ler em streaming com limite explícito de 1 MiB e
  documentar).
- Erro de SSRF vira falha do nó com código `ssrf_blocked` e mensagem PT-BR legível no log da execução
  ("Endereço bloqueado por segurança: rede interna"), sem expor o IP resolvido.
- Testes no port e no handler.

## Fora de escopo

- Qualquer outra mudança no flow-engine.

### files_allowed

- `packages/flow-engine/src/ports/http.port.ts`
- `packages/flow-engine/src/ports/http.port.test.ts`
- `packages/flow-engine/src/handlers/http_request.handler.ts`
- `packages/flow-engine/src/handlers/http_request.handler.test.ts`
- `packages/flow-engine/package.json`

## Definition of Done

- [ ] teste: `http://169.254.169.254/latest/meta-data`, `http://127.0.0.1:5432`, `http://10.0.0.5`,
      `http://[::1]`, host com DNS para IP privado e redirect 302 para IP privado ⇒ `ssrf_blocked`
- [ ] teste: URL pública (servidor de teste em host permitido pela allowlist de dev) continua funcionando
- [ ] teste: falha do nó tem mensagem legível e não vaza IP resolvido
- [ ] typecheck do flow-engine e dos workers

## Validação

```bash
pnpm --filter @hm/flow-engine typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/flow-engine exec vitest run src/ports src/handlers/http_request --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. Pedir `security-auditor` antes do merge.
