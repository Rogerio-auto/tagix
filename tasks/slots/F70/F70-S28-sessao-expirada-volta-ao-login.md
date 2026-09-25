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
- `apps/web/shared/auth/**`, `apps/web/shared/lib/api-client.ts`, `apps/web/shared/lib/public-routes.ts` *(correção 2026-09-25: o handler central de 401 (F46-S01), o cliente HTTP e a guarda de rota já moram em `shared/`, não em `lib/` — `apps/web/lib/` nem existe)*
- `apps/web/shared/stores/auth.store.ts` *(correção: a hidratação de `/api/me` é o primeiro 401 de quem abre o app com cookie morto)*
- `apps/web/shared/realtime/**` *(correção: o `SocketProvider` mora aqui, não em `features/`)*
- `apps/web/shared/pwa/**`, `apps/web/public/sw-strategy.js` *(correção: o registro do SW e a regra de cache testável da F61-S01 moram fora de `sw.js`)*
- `apps/api/src/auth/session.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/session.test.ts`, `apps/api/src/auth/routes.test.ts` *(correção: as rotas `/auth/*` e `/api/me` moram em `apps/api/src/auth/`, não em `routes/auth/`, que não existe)*

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

## Diagnóstico (2026-09-25, reproduzido no dev antes de qualquer correção)

API local (`tsx src/index.ts`, Postgres/Redis/RabbitMQ do compose) e leitura do código do web no
estado de `a1c50a00`. "Sessão revogada" e "cookie presente e inválido" percorrem o mesmo caminho: o
provider devolve `null` em `verifyToken` e `resolveSession` devolve `null`.

Evidência na API:

```text
GET /api/me                sem cookie            → 401 {"message":"Não autenticado."}  (sem Set-Cookie)
GET /api/me                hm_session=<expirado> → 401 {"message":"Não autenticado."}  (sem Set-Cookie)
GET /api/conversations     hm_session=lixo       → 401                                 (sem Set-Cookie)
socket.io (polling) + "40" hm_session=lixo       → 44{"message":"unauthorized"}
  log: {"svc":"socket","hasCookieHeader":true,"hasSessionCookie":true,"msg":"handshake unauthorized"}
POST /auth/login           hm_session=lixo + senha errada → 401 "Email ou senha incorretos."
```

A última linha é o log de produção de 25/09 12:45, idêntico. Nenhuma resposta limpa o cookie morto,
então ele fica no navegador até o `maxAge` de 7 dias.

### Sintoma 1: cookie ausente

O middleware já redirecionava para `/login?next=<pathname>`, mas descartava a query da rota. Não há
bug de travamento aqui. Corrigido de passagem: a query agora vai junto e passa pelo `safeNextPath`.

### Sintoma 2: cookie presente e inválido (o relato do Rogério)

Quatro portas abertas em sequência, e nenhuma fecha:

1. **`middleware.ts` só testa a presença do cookie** (`Boolean(req.cookies.get('hm_session'))`).
   O cookie morto passa.
2. **`(app)/layout.tsx` → `getServerSession()` é um STUB** ("cookie presente = sessão fake"). Passa de
   novo, e o shell do app é renderizado.
3. **O handler central de 401 (F46-S01) nunca dispara na abertura a frio.** O guard anti-loop é
   `useAuthStore.auth !== null`. Quem abre o app com o cookie morto nunca teve `auth`: o `hydrate()`
   de `/api/me` recebe 401, grava `status: 'unauthenticated'` e mais nada, porque chama `api.get`
   direto, fora do `QueryCache`. Os 401 das queries da tela caem no mesmo guard e também são
   ignorados. Resultado: shell vazio, sem redirect.
4. **Socket.** O `SocketProvider` fica no layout RAIZ e conecta em toda página, inclusive `/login`.
   Com o cookie morto, o handshake volta `unauthorized`. O socket.io-client 4.8.3 faz `destroy()` no
   `CONNECT_ERROR` (conferido em `build/esm/socket.js:502`), e ninguém trata o erro além de um
   `console.warn`. Cada abertura de página gera um `handshake unauthorized` no log. Esse é o
   "continua tentando" visto em produção: não é um laço, é uma tentativa por carregamento, em toda
   aba e em todo dispositivo. Efeito colateral: depois do login, a navegação é client-side e o
   provider raiz continua com o socket destruído, então o tempo real fica morto até um reload.

### Sintoma 3: "no PWA não consigo logar"

Não é a API: `POST /auth/login` com o cookie morto presente chega ao provider normalmente (ver a
evidência acima). Também não é o SW v1: `/auth/*` e `POST` são `network-only`, sem `respondWith`. A
causa é a combinação do sintoma 2 com o modo `standalone`:

- o PWA não tem barra de endereço, então não há como digitar `/login`;
- o botão "Sair" some, porque `Sidebar` e `TopBar` só renderizam o `UserMenu` quando `auth != null`,
  e `auth` nunca é preenchido com o cookie morto;
- o `start_url` é `/hoje`, rota protegida, e cai sempre no shell vazio.

Não existe caminho até o formulário de login. Sem PWA, o navegador contorna o problema digitando a
URL. No PWA, só apagar os dados do app resolve.

### Service worker (F61-S01, `leadium-v1`): riscos reais, mesmo sem ser a causa do login

- Navegação é `network-first` e **guarda no cache o HTML autenticado** de cada tela (`guardar()` só
  olha `ok`). Com rede ruim ou oscilando, o SW serve o shell de ontem, "logado", a quem já não tem
  sessão. Contraria a regra "nunca do cache" desta spec.
- Redirects: `fetch(navigationRequest)` usa `redirect: 'manual'` e devolve `opaqueredirect`, que não é
  cacheado (`ok === false`) e é devolvido ao navegador. Funciona, mas só por acaso. Nenhuma checagem
  explícita, e uma resposta `redirected` de um GET de asset poderia ser guardada.
- Sem `skipWaiting` e sem ninguém mandar `skip-waiting`, o worker novo fica em `waiting` enquanto
  houver QUALQUER cliente aberto. No PWA do iOS o processo sobrevive em segundo plano, e a versão
  velha fica presa por dias.

### Bug correlato encontrado

`PATCH /api/members/me` (troca de senha) responde **401** `invalid_current_password`. Hoje, errar a
senha atual numa sessão válida dispara o handler central e desloga a pessoa. Também: na indisponibilidade
do Supabase, sem cache, `resolveSession` devolve `null` e a API responde 401. Uma instabilidade do
provedor vira "sessão terminou" em massa.
