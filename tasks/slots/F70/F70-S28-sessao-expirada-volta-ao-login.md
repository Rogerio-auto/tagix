---
id: F70-S28
title: Sessão expirada volta ao login, no navegador e no PWA
phase: F70
status: in-progress
priority: critical
estimated_size: M
depends_on: [F70-S01]
blocks: []
source_docs:
  - tasks/slots/F61/F61-S01-service-worker.md
agent_id: backend-engineer
claimed_at: 2026-09-25T19:49:22Z

---
# F70-S28 — Sessão expirada volta ao login, no navegador e no PWA

## Objetivo

Quando a sessão termina, o Leadium leva a pessoa para o login com uma mensagem clara, no navegador e no app instalado (PWA). O login funciona na primeira tentativa, sem precisar limpar cache nem reinstalar o app.

## Contexto (relato do Rogério, 25/09)

- Ao abrir o Leadium com a sessão encerrada, a tela não redireciona para o login.
- No PWA acontece o mesmo e, além disso, **não consegue logar**.
- Nos logs da API de produção (25/09, 12:45) aparece `socket: handshake unauthorized` com `hasSessionCookie: true`: o cookie existe, mas a sessão não vale mais. O app continua tentando em vez de sair.
- O app tem service worker (F61-S01: app shell, versionamento, "saída de emergência"). É forte suspeito no PWA: HTML ou resposta de auth servidos do cache, redirect interceptado, ou `POST /auth/login` passando pelo SW.

## Escopo

### files_allowed

- `apps/web/middleware.ts`
- `apps/web/app/(auth)/**`
- `apps/web/app/(app)/layout.tsx`
- `apps/web/lib/**`
- `apps/web/features/auth/**`
- `apps/web/features/pwa/**`
- `apps/web/public/sw.js`
- `apps/web/public/manifest*`
- `apps/web/app/sw*`
- `apps/web/**/*.test.ts`, `apps/web/**/*.test.tsx`
- `apps/web/e2e/**`
- `apps/api/src/middlewares/auth.ts`
- `apps/api/src/routes/auth/**`
- `apps/api/src/socket/**`

*(Antes de editar fora da lista, nota de correção no slot, no padrão da F69-S03.)*

## Escopo (faz)

- **Diagnóstico com evidência:** reproduzir no dev (sessão expirada ou revogada, cookie presente e inválido, cookie ausente) no navegador e com o service worker ativo. Registrar no slot a causa de cada sintoma.
- **Navegador:**
  - navegação para rota protegida sem sessão válida → redirect de servidor para `/login?next=<rota>`, sem piscar a tela;
  - chamada de API com 401 em qualquer lugar do app → um único handler central limpa o estado e leva ao login com "Sua sessão terminou. Entre de novo.";
  - socket com `handshake unauthorized` → não fica reconectando em laço; dispara o mesmo fluxo.
- **PWA / service worker:**
  - navegação, `/auth/*` e `/api/*` nunca respondem do cache;
  - redirects não são "engolidos" (tratar `opaqueredirect` e `redirect: 'manual'`);
  - `POST` passa direto;
  - versão nova do SW assume sem deixar a antiga presa; a saída de emergência continua funcionando.
- **Login:**
  - cookie inválido presente não impede o login (o servidor limpa e emite o novo);
  - depois de logar, volta para o `next` validado (só caminho interno, sem open redirect).

## Definition of Done

- [ ] teste: rota protegida com cookie inválido → redirect para `/login?next=…`
- [ ] teste: 401 numa chamada de API → vai ao login uma vez, sem laço
- [ ] teste: socket não autorizado → sem reconexão infinita, vai ao login
- [ ] teste do SW: navegação e `/auth/*` nunca do cache; `POST /auth/login` passa direto
- [ ] teste: login com cookie inválido presente funciona na primeira tentativa
- [ ] `next` só aceita caminho interno (teste de open redirect)
- [ ] e2e (Playwright) do fluxo de sessão expirada, se o ambiente permitir; senão, o roteiro manual no slot
