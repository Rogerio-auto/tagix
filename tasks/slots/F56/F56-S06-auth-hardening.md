---
id: F56-S06
title: Auth hardening — fail-fast mock, rate-limit por IP, stale token
phase: F56
status: done
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-10T04:40:58Z

---
# F56-S06 — Auth hardening (SEC-02/SEC-05/SEC-08)

> **Origem:** AUDITORIA_TECNICA.md §3.1. `AUTH_PROVIDER=mock` é honrado sem checar `NODE_ENV` (bypass total); rate-limit de login por IP+email não barra spraying distribuído; cache de identidade serve token expirado por até 15 min.

## Objetivo

Fechar os três buracos de autenticação: interruptor mock em produção, credential stuffing por IP e honra de token revogado.

## Contexto / causa raiz (verificada)

- **SEC-02:** `apps/api/src/auth/provider.ts:21-24` retorna `MockAuthProvider` se `AUTH_PROVIDER==='mock'` sem guarda de ambiente; o mock aceita qualquer senha e emite token = base64 do payload.
- **SEC-05:** `auth/routes.ts:24` + `rate-limit.ts:97-101` — chave IP+email; um IP contra N emails nunca bloqueia; login sem Turnstile.
- **SEC-08:** `auth/session.ts:104-120` — o ramo stale honra token quando `verifyToken` retorna `null` (inclui expirado/revogado), não só em erro de rede.

## Escopo (faz)

- Fail-fast no boot: `if (NODE_ENV==='production' && AUTH_PROVIDER==='mock') throw`.
- Segundo limiter puramente por IP no login (ex. 60/min/IP) além do IP+email; captcha após N falhas.
- Só servir identidade stale quando o provider **lança** (erro de rede), não quando retorna `null` (invalidação legítima).

## Escopo (não faz)

- SSRF de webhooks (F56-S07). RLS/role de banco (F56-S08).

## Arquivos permitidos

- `apps/api/src/auth/**`

## Arquivos proibidos

- `apps/api/src/middlewares/rate-limit.ts` (compartilhado — se precisar de nova chave por-IP, adicione a opção via parâmetro **sem** quebrar assinatura; senão sinalize em COMMS)

## Definition of Done

- [ ] Boot em produção com `AUTH_PROVIDER=mock` aborta com erro claro.
- [ ] Login tem teto por IP independente do email (teste).
- [ ] Token expirado deixa de ser honrado por stale (só erro de rede serve stale).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

- Afeta o gate de autenticação global; sem mudança na matriz de roles (`docs/features/PERMISSIONS.md §2`).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Distinguir no `SupabaseAuthProvider.verifyToken` "throw" (rede) de "null" (inválido) é o ponto central de SEC-08.
