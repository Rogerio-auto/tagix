---
id: F44-S03
title: Rate-limit Redis (IP+email) + Turnstile verify + CSP do captcha
phase: F44
status: available
priority: high
estimated_size: M
depends_on: []
blocks: [F44-S04]
agent_id: backend-engineer
security_review: required
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
---
# F44-S03 [SEC] — Rate-limit + captcha verify + CSP

> source_docs: docs/features/SELF_SERVE_SIGNUP.md §3 (T4, T10, T12)
> depends_on: nenhum (onda 1; disjunto de S01/S02). blocks: F44-S04.

## Objetivo

Construir os middlewares de borda que protegem os endpoints de auth contra brute-force/
mass-signup/credential-stuffing, verificar o Turnstile server-side, e abrir o CSP so para o
dominio do captcha.

## Escopo (faz)

1. Rate-limit — novo apps/api/src/middlewares/rate-limit.ts:
   - Store no Redis existente (reusar o client de apps/api/src/cache/index.ts ou criar client
     lazy analogo — NAO duplicar config; ler loadConfig().redisUrl).
   - Janela fixa/deslizante por chave. Factory rateLimit({ key, max, windowSec }) que compoe a
     chave de IP + email (quando o body traz email) ou so IP.
   - Fail-open controlado se o Redis cair (nao derruba o login), mas conta como evento de
     auditoria (T10). Limites por rota: login/signup/reset/verify (configuraveis por env, com
     defaults saos — ex. signup 5/h por IP, login 10/15min por IP+email).
   - Resposta 429 com shape de erro padrao do projeto (UX §2.11), sem vazar contagem exata.
   - Helper de audit log para login-falho/signup/reset (reusar padrao de routes/audit.ts se
     exportavel; senao expor um hook que S04 chama).

2. Turnstile verify — funcao verifyTurnstile(token, remoteIp): Promise<boolean> no mesmo modulo
   (ou apps/api/src/middlewares/turnstile.ts se ficar mais limpo, dentro do files_allowed). Chama
   o siteverify do Cloudflare Turnstile com o secret server-side (TURNSTILE_SECRET_KEY de env —
   nunca no cliente). Em dev sem secret, modo permissivo explicito e logado (nunca em producao).

3. CSP — em apps/api/src/middlewares/security.ts, adicionar SO o dominio do Turnstile
   (https://challenges.cloudflare.com) a script-src, frame-src e connect-src. SEM unsafe-inline/
   unsafe-eval. Configuravel por env (CSP_CAPTCHA_SRC com default no dominio Cloudflare). Nao
   afrouxar nenhuma outra diretiva.

## Fora de escopo

- Montar os middlewares nas rotas (S04 faz o wiring em routes.ts). UI do widget (S05).

## Arquivos permitidos

- apps/api/src/middlewares/rate-limit.ts (novo)
- apps/api/src/middlewares/turnstile.ts (novo, opcional)
- apps/api/src/middlewares/security.ts (so CSP do captcha)
- apps/api/src/middlewares/rate-limit.test.ts (novo)

## Arquivos proibidos

- apps/api/src/auth/** (S04), apps/api/src/app.ts
- packages/**, apps/web/**

## Definition of Done

- [ ] rateLimit(...) factory funcional sobre Redis; chave IP+email; fail-open auditado.
- [ ] 429 com shape de erro padrao; sem vazar contagem.
- [ ] verifyTurnstile valida server-side; secret so de env; dev-permissivo explicito e nunca em prod.
- [ ] CSP libera SO challenges.cloudflare.com em script/frame/connect-src; zero unsafe-* novos.
- [ ] Teste cobre: bloqueio apos N tentativas + reset de janela + Turnstile invalido.
- [ ] pnpm typecheck + pnpm lint + pnpm --filter @hm/api test verdes.

## Validacao

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: backend-engineer. [SEC] — gate antes do finish: T4 (rate-limit efetivo),
  T12 (CSP so o captcha, sem unsafe), T10 (auditoria de tentativas).
