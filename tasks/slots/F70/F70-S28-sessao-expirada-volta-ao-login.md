---
id: F70-S28
title: Sessão expirada volta ao login, no navegador e no PWA
phase: F70
status: review
priority: critical
estimated_size: M
depends_on: [F70-S01]
blocks: []
source_docs:
  - tasks/slots/F61/F61-S01-service-worker.md
agent_id: backend-engineer
claimed_at: 2026-09-25T19:49:22Z
completed_at: 2026-09-25T20:21:24Z

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
- `apps/web/shared/auth/**`, `apps/web/shared/lib/api-client.ts`, `apps/web/shared/lib/query-client.ts`, `apps/web/shared/lib/public-routes.ts` *(correção 2026-09-25: o handler central de 401 (F46-S01), o cliente HTTP, o QueryClient que liga os dois e a guarda de rota já moram em `shared/`, não em `lib/`. `apps/web/lib/` nem existe)*
- `apps/web/shared/realtime/**` *(correção: o `SocketProvider` mora aqui, não em `features/`)*
- `apps/web/playwright.config.ts` *(correção: a checagem de sessão do middleware roda no servidor, fora do `page.route`; o `webServer` do e2e passa a apontar `API_PROXY_TARGET` para uma porta própria, para o e2e continuar determinístico com a API de dev no ar)*
- `apps/web/shared/pwa/**`, `apps/web/public/sw-strategy.js` *(correção: o registro do SW e a regra de cache testável da F61-S01 moram fora de `sw.js`)*
- `apps/api/src/auth/session.ts`, `apps/api/src/auth/index.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/auth/session.test.ts`, `apps/api/src/auth/routes.test.ts` *(correção: as rotas `/auth/*` e `/api/me` moram em `apps/api/src/auth/`, não em `routes/auth/`, que não existe)*

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

- [x] teste: rota protegida com cookie inválido → redirect para `/login?next=…` *(route-guard.test: `decideRoute`, com motivo e cookie apagado)*
- [x] teste: 401 numa chamada de API → vai ao login uma vez, sem laço *(session-expiry.test: hidratação, rajada de 4 chamadas → 1 redirect, 401 no `/login` → nenhum)*
- [x] teste: socket não autorizado → sem reconexão infinita, vai ao login *(session-guard.test + handshake.test da API)*
- [x] teste do SW: navegação e `/auth/*` nunca do cache; `POST /auth/login` passa direto *(strategy.test: navegação/RSC/`/auth`/`/api/me` `network-only`; `isCacheable` recusa redirect)*
- [x] teste: login com cookie inválido presente funciona na primeira tentativa *(routes.test da API: 200 + `Set-Cookie` novo substitui o morto)*
- [x] `next` só aceita caminho interno (teste de open redirect) *(route-guard.test: 11 vetores + `next` para tela pública vira `/`)*
- [x] e2e (Playwright) do fluxo de sessão expirada, se o ambiente permitir; senão, o roteiro manual no slot *(spec escrita em `e2e/specs/session-expired.spec.ts`; a execução estourou a memória da máquina (OOM do worker com o `next dev` no ar, 8 GB). Roteiro manual abaixo)*

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

## Correção (o que mudou)

### Servidor web: `middleware.ts` → `shared/auth/route-guard.ts`

- A decisão saiu do middleware para uma função pura e testada (`decideRoute`). O middleware virou um adaptador.
- Sem cookie: redirect para `/login?next=<rota + query>`, como antes, agora com a query preservada.
- Com cookie, **só na carga de documento** (`Sec-Fetch-Dest: document`; o fallback é o `Accept`), o middleware consulta `GET <API_PROXY_TARGET>/api/me`, com teto de 2,5s:
  - `401` → redirect de servidor para `/login?next=…&motivo=sessao-expirada`, com o `hm_session` morto **apagado na mesma resposta** e `Cache-Control: no-store`;
  - `200` → segue;
  - rede, timeout, 5xx ou 503 → segue (fail-open).
- Pedidos RSC e prefetch não são checados. Uma checagem por abertura, nenhuma por clique.
- `PUBLIC_PREFIXES` saiu para `shared/lib/public-routes.ts`, com casamento por segmento: `/loginx` deixou de ser público.

### API

- `resolveSessionStatus` (em `auth/session.ts`) separa `invalid` (o provider disse `null`, ou o member está inativo ou sem workspace) de `unavailable` (o provider lançou erro e não havia cache).
- `requireAuth` e `/api/me` respondem `401 {error:'session_invalid'}` e `503 {error:'auth_unavailable'}`. Instabilidade do Supabase deixa de deslogar todo mundo.
- `/auth/login` só emite o cookie **depois** de confirmar member e workspace. Antes, um 403 plantava um cookie inútil. O cookie novo substitui o morto (mesmo nome e mesmo path).
- Socket: o handshake recusa com `unauthorized` (sessão morta) ou `auth_unavailable`, e o log ganha `reason`.

### Fetch (cliente)

- `api-client` lê o `error` do corpo para `ApiError.code` e avisa um listener único em todo 401 (`setUnauthorizedListener`). O `makeQueryClient` registra o handler central. Os `onError` dos caches continuam como segunda entrada, e o latch garante um único redirect.
- `session-expiry`: o guard deixa de ser "havia `auth` no store" e passa a ser "401 de sessão numa tela protegida". Tela pública nunca redireciona, e é isso que impede o laço. O 401 `invalid_current_password` não desloga. O redirect leva `motivo=sessao-expirada`.
- O login mostra "Sua sessão terminou. Entre de novo." (lido no servidor, sem piscar, com tokens `info`). O `next` passa por `postLoginPath`, que é o `safeNextPath` mais a regra de trocar tela pública por `/`.

### Socket (cliente)

- O `SocketProvider` só conecta em tela protegida (`enabled` por rota). O `/login` deixa de gerar `handshake unauthorized`, e o socket nasce de novo, com o cookie novo, quando o login leva à primeira tela.
- `shared/realtime/session-guard.ts`:
  - `unauthorized` → `disconnect` e o mesmo `handleSessionExpired`, uma vez, sem reconectar;
  - outra recusa, com `active=false` → nova tentativa com backoff de 2s a 60s, sem empilhar;
  - erro de transporte → fica com o socket.io.

### Service worker

- Navegação passa a ser `network-only`, sem `respondWith`: o redirect de sessão é sempre do navegador.
- `isCacheable` só aceita `basic`, 2xx e sem `redirected`. `opaqueredirect` nunca entra no cache.
- `VERSAO` passa a `leadium-v2`: o `activate` apaga o cache da v1, que tinha HTML autenticado.
- A página manda `skip-waiting` ao worker em espera num momento seguro: tela pública ou app em segundo plano (`shared/pwa/sw-update.ts`). A v1 já tinha o handler de mensagem, e quem recebe a mensagem é o worker novo. O kill switch não mudou.

### UX aplicada (UX_PRINCIPLES)

- **§2.7, feedback imediato:** o redirect é de servidor, sem o shell vazio piscar. O botão "Entrar" segue com `loading`.
- **§2.11, mensagem que explica:** o aviso diz o que houve ("Sua sessão terminou. Entre de novo.") e o que acontece depois ("Você volta para onde estava"). Usa `role="status"` e o tom `info`, não o de erro, porque não é culpa de quem está usando.
- **§8, paridade mobile/PWA:** o fluxo não depende de barra de endereço nem do menu "Sair", que sumia com `auth=null`.

## Depois do deploy: PWA do Rogério

Não há passo manual. Na primeira abertura com rede, a v1 ainda busca o documento pela rede (é `network-first`), e a navegação cai no middleware novo:

1. o redirect vai para `/login?...&motivo=sessao-expirada` e o cookie morto é apagado;
2. o JS novo registra o `sw.js` v2;
3. como a página está numa tela pública, ela manda `skip-waiting`;
4. a v2 assume e apaga o cache da v1.

Só se o app abrir **sem rede** a v1 pode servir o HTML de ontem. Nesse caso, basta abrir de novo com rede. O kill switch (`sw-kill.json` → `disabled: true`) segue disponível e não é necessário.

## Roteiro e2e manual

A spec automatizada `apps/web/e2e/specs/session-expired.spec.ts` sobe uma "API de sessão" na porta `3199`, que o `webServer` do Playwright usa como `API_PROXY_TARGET`. Rodar numa máquina com memória: `pnpm --filter @hm/web e2e -- e2e/specs/session-expired.spec.ts e2e/specs/auth.spec.ts`.

Roteiro manual equivalente (API e web de dev no ar):

1. **Cookie morto.** No DevTools → Application → Cookies, troque o valor de `hm_session` por `lixo` e abra `/hoje`.
   - Esperado: um 307 para `/login?next=%2Fhoje&motivo=sessao-expirada`, sem o shell piscar.
   - Esperado: o aviso "Sua sessão terminou. Entre de novo." e o cookie `hm_session` sumiu.
2. **Login com o cookie morto.** Repita o passo 1 sem apagar nada e entre com a senha certa.
   - Esperado: entra na 1ª tentativa e volta para `/hoje`.
   - Esperado: o socket conecta (Network → WS `101`) e o log da API mostra `socket conectado`, sem nenhum `handshake unauthorized`.
3. **Sessão revogada com o app aberto.** Com o app em `/conversations`, faça logout em outra aba (`POST /auth/logout`) ou revogue a sessão no Supabase, e navegue ou espere o refetch.
   - Esperado: um único redirect para `/login?next=%2Fconversations&motivo=sessao-expirada`, sem laço.
4. **Socket.** Com a sessão revogada, force a reconexão do socket (derrube a API por 5s e suba de novo).
   - Esperado: um único `handshake unauthorized` com `reason: invalid` no log, e depois o login. Nenhuma tentativa repetida.
5. **Open redirect.** Abra `/login?next=%2F%2Fevil.example` e entre.
   - Esperado: cai em `/`, nunca em `evil.example`.
6. **PWA.** Em `next build && next start` sob HTTPS (ou `localhost`), com o SW registrado:
   - Application → Service Workers mostra a `leadium-v2` ativa;
   - com o cookie morto, abrir o app instalado leva ao login e o login funciona;
   - Network mostra a navegação sem "(ServiceWorker)" e o `POST /auth/login` sem passar pelo worker.

## Validação

Rodado localmente: typecheck do web e da API, ESLint e Prettier nos arquivos tocados, e os vitest abaixo.

- Web: 139 testes em 10 arquivos.
- API: 48 testes em 4 arquivos, mais os 15 do `socket/relay.test`, rodados à parte. As rotas de auth usam o Postgres de dev.
- `python scripts/slot.py validate F70-S28`: os 4 comandos abaixo passaram.
- `next dev` compilou o `middleware` e o `/login` (`GET /login 200`) antes de o worker do Playwright estourar a memória. `next build` não foi rodado, pelo mesmo limite de RAM.

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/web typecheck
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/auth/session.test.ts src/auth/routes.test.ts src/middlewares/impersonation.test.ts src/socket/handshake.test.ts --maxWorkers=1
node apps/web/node_modules/vitest/vitest.mjs run --root apps/web shared/auth shared/realtime shared/pwa shared/lib --maxWorkers=1
```

## Pendências e riscos

- **O middleware passa a depender de `API_PROXY_TARGET` em runtime** (`http://api:3001` no compose de produção). Se a variável faltar, a checagem falha aberta: nada quebra, só volta o comportamento antigo na carga a frio, e o handler do cliente ainda leva ao login.
- **Custo:** um `GET /api/me` interno por carga de documento com cookie. A API tem cache de identidade de 5 min, mas o resto são duas consultas ao banco.
- **Corrida rara:** uma navegação com o cookie morto numa aba, ao mesmo tempo que o login em outra, pode apagar o cookie novo. A janela é de milissegundos, e o efeito é pedir o login de novo.
- **Fail-open com o `auth.status === 'error'`** (API fora na abertura): o shell abre sem o menu "Sair", como antes. Fica fora deste slot.
- **`hm_impersonation` não é apagado** quando a sessão morre. A API valida o claim contra a sessão, então não há risco, só um banner que pode aparecer até o próximo login.
- **Guarda de plataforma:** `features/platform-admin/lib/guard.ts` usa `NEXT_PUBLIC_API_URL ?? API_INTERNAL_URL ?? localhost:3001`, e nenhuma das duas variáveis existe no compose de produção. Parece apontar para `localhost` em produção. Não é deste slot; vale conferir.
- **e2e `auth.spec` "credenciais inválidas"** espera "Não foi possível entrar", mas o `LoginForm` mostra "Email ou senha incorretos" no 401. A spec parece já estar desatualizada e não foi mexida aqui. Só a asserção de URL de "deslogado → /login" foi ajustada ao `next`.
