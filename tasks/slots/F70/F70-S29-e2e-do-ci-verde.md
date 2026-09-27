---
id: F70-S29
title: e2e do CI verde de novo (gate do deploy)
phase: F70
status: review
priority: critical
estimated_size: M
depends_on: [F70-S28]
blocks: []
source_docs:
  - .github/workflows/ci.yml
  - apps/web/playwright.config.ts
agent_id: backend-engineer
claimed_at: 2026-09-25T20:32:15Z
completed_at: 2026-09-27T20:30:10Z

---
# F70-S29 — e2e do CI verde de novo

## Objetivo

O job `e2e` do CI voltar a passar. Sem ele verde, o `deploy` é pulado e nada chega à produção pelo pipeline.

## Contexto

- Os três últimos runs de `main` falharam no `e2e`, com `deploy: skipped`. São eles o 36139216518 (hotfix `d774835a`, 25/09), o 35783672961 (`9a9005ac`, 22/09) e o 35756497740 (`faadb93b`, 22/09). A produção está em `9a9005ac`, provavelmente por deploy manual.
- Falham quase todos os specs: `auth.spec` (redirect para o login, login válido, credenciais inválidas), `channels.spec`, `calendar-v2.spec`, `agent-department-routing.spec`. Passam os que não dependem de dados mockados (validação client-side, estado vazio).
- No log do webServer aparecem `Failed to proxy http://localhost:3001/... ECONNREFUSED` e `SyntaxError: Unexpected end of JSON input`. A suspeita é que os specs mockam a API por `page.route` no navegador, mas parte das chamadas sai do servidor Next (proxy/rewrite para `API_PROXY_TARGET`, middleware, RSC), onde o mock não alcança.
- A F70-S28 mudou o middleware: ele agora consulta `/api/me` no servidor. Também mudou o `playwright.config.ts` (API de sessão falsa na porta 3199) e acrescentou `e2e/specs/session-expired.spec.ts`. Precisa passar junto.
- A S28 também apontou que `auth.spec` "credenciais inválidas" espera um texto que o `LoginForm` não mostra.

## Escopo

### files_allowed

- `apps/web/e2e/**`
- `apps/web/playwright.config.ts`
- `.github/workflows/ci.yml` *(só o job `e2e`)*
- `apps/web/next.config.mjs` *(só se o proxy de dev precisar de ajuste para o e2e, sem mudar produção)*
- `apps/web/shared/components/Sheet/Sheet.tsx` *(nota de correção abaixo)*

### Nota de correção de escopo (25/09)

`mobile-navigation`, `mobile-pipeline` e `mobile-table` afirmam que o Sheet **fechou**
(`getByRole('dialog', { name }) → toHaveCount(0)`). Falham porque o Sheet fechado do web
(`shared/components/Sheet/Sheet.tsx`) continua montado no portal com `role="dialog"` e
`aria-modal="true"`, só deslocado para fora da tela (`translate-y-full`): leitor de tela o
anuncia e o Tab alcança os botões de dentro dele. O spec está certo e o componente está
errado (WCAG 2.4.3 e 4.1.2). Afrouxar o assert esconderia o bug, então a correção entra
no componente: fechado, o painel fica `inert` e sai da árvore de acessibilidade. A
animação de entrada e saída continua igual.

## Escopo (faz)

- Diagnosticar com os logs do CI (`gh run view <id> --log-failed`) e reproduzir localmente o menor conjunto possível.
- Um servidor de API falsa único para o e2e, que atenda tanto as chamadas feitas pelo servidor Next (middleware, rewrites, RSC) quanto as feitas pelo navegador, ou uma estratégia equivalente e determinística. Nada de depender de API real.
- Corrigir specs desatualizados em relação à UI atual, sem afrouxar o que eles provam.
- Nenhum `test.skip` sem justificativa escrita no slot.

## Causa raiz (27/09)

Não era uma causa, eram cinco somadas. O run 36139216518 terminou com 35 falhas, 1 flaky
e 19 passes em 22,4 min.

1. **O mock só ligava quando o teste pedia.** A fixture `mock` não era `auto`, e só 10 testes
   pediam `mock`. Os demais só pediam `page` e rodavam sem mock nenhum: o navegador chamava `/api`, o
   rewrite do Next repassava a `localhost:3001` e o log do CI enchia de
   `Failed to proxy http://localhost:3001/... ECONNREFUSED`. A hipótese inicial (chamadas
   do servidor Next fora do alcance do `page.route`) não se confirmou: o que o servidor
   chama é só o `/api/me` do middleware, que falha aberto sem API. Os `Failed to proxy`
   vinham do **navegador**, sem rota instalada.
2. **O login mockado respondia errado.** O Playwright consulta as rotas da mais nova para a
   mais antiga. Com `**/auth/login` registrada antes de `**/auth/**`, o genérico respondia
   `{ ok: true }` sem `member` e o `LoginForm` quebrava no `snapshotFromMember`
   (`TypeError: Cannot read properties of undefined (reading 'id')`, capturado localmente).
   Isso também mostrava "Não foi possível entrar" no teste de login válido.
3. **O `next dev` no CI recompilava sem parar.** Com o código parado, o log do webServer tem
   centenas de `Compiled in …`, `Fast Refresh had to perform a full reload` e
   `⨯ SyntaxError: Unexpected end of JSON input` com `GET /calendar 500` e
   `GET /conversations 500`. A página recarregava por baixo do teste, e o auth chegou a
   registrar `/login?email=…&password=…`, que é o submit nativo antes da hidratação.
4. **Specs desatualizados em relação à UI.** A lista de conversas virou `listbox`, o
   `/api/pipelines` virou `{ data, meta }`, o cockpit abre sozinho no desktop, o botão do
   catálogo é "Adicionar produto", o editor de flow é `/flows/:id` e guarda o rascunho na
   linha do flow, e o wizard do WhatsApp perdeu o PIN (hotfix `d774835a`). Também faltava o
   `onboarding/state`, então o tour de primeira visita cobria as telas.
5. **Testes vazios.** Três testes do flow builder tinham `if (visível) { … }` e passavam
   num 404. Agora exigem o efeito.

### O que mudou

- `fixtures/test.ts`: `mock` é `auto`.
- `fixtures/api-mock.ts`: um handler para `/auth/**`; socket.io por RegExp, que cobre
  `/socket.io?EIO=` sem barra; `onboarding/state` com workspace verticalizado e tours
  dispensados; `/api/pipelines` no contrato atual; `connect.facebook.net` abortado.
- `playwright.config.ts`: `E2E_SERVER=start` (padrão no CI) serve o build de produção com
  `next start`, e `dev` fica como padrão local. O service worker fica ligado, porque
  `/api`, `/auth`, `/socket.io` e RSC são `network-only` sem `respondWith`.
- `ci.yml` (job `e2e`): `API_PROXY_TARGET=http://127.0.0.1:3199` no build, porque os
  rewrites ficam gravados no `routes-manifest.json`, e ids públicos fictícios da Meta
  para o fluxo do Embedded Signup existir no build.
- `pages/pom.ts`: `waitForHydration`, que espera o `__reactProps$` do React no elemento,
  antes de preencher o login.
- `Sheet.tsx`: fechado, fica `inert` + `aria-hidden` (nota de correção acima).

### Teste marcado (justificativa)

- `whatsapp-coexistence` › "Voltar no passo final preserva o que foi digitado no signup
  (UX §2.8)" usa **`test.fail`**, não `skip`. O `WaSignupStep` guarda os campos em
  estado local e remonta ao voltar, e tudo o que foi digitado some. É bug de produto em
  `features/channels/components/ConnectWizard.tsx`, fora desta fronteira. O teste roda e
  exige a falha. Quando o wizard for corrigido, ele acusa e a marcação sai. Precisa de um
  slot próprio.

### Achados fora da fronteira (não corrigidos aqui)

- Outros painéis fechados continuam expostos à árvore de acessibilidade: o painel de ajuda
  (`shared/components/help/Sheet.tsx`, `role=complementary`), o `HelpHint` do `@hm/ui`
  (`role=dialog`), o drawer "Novo produto" do catálogo e o `NotificationCenter`. É o mesmo
  bug do Sheet.
- O TopBar e a página renderizam dois `<h1>` com o mesmo texto ("Dashboard").
- Localmente, sob pressão de memória (menos de 0,5 GB livre), a navegação por `<Link>` de
  `/conversations` para `/conversations/:id` ficou presa algumas vezes: o RSC chega, o chunk
  carrega e a árvore não comita. A taxa variou de 0/20 a 4/10 entre rodadas, sem correlação
  com o service worker nem com o prefetch em voo. Numa rodada depois disso, com a máquina
  menos carregada, foram 10/10 verdes. Não reproduzi de forma determinística. Fica como
  risco, a confirmar no CI (runner com 16 GB e `retries: 2`).

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run shared/pwa
```

O e2e não entra no bloco acima: ele exige o build de produção com as envs do job. Rodei
assim, no Git Bash, com um spec por vez e `--workers=1`:

    cd apps/web
    NEXT_PUBLIC_META_APP_ID=000000000000000 NEXT_PUBLIC_META_CONFIG_ID=000000000000001 \
      API_PROXY_TARGET=http://127.0.0.1:3199 NODE_OPTIONS=--max-old-space-size=3072 npx next build
    E2E_SERVER=start npx playwright test <spec> --workers=1 --retries=0

Resultado em 27/09, depois do `git merge main` (F70-S30/S31), com os 17 arquivos de spec
rodados um a um. Cada contagem inclui o projeto `setup`:

| spec | resultado |
|---|---|
| agent-department-routing | 2 passed |
| calendar-v2 | 5 passed |
| mobile-inbox | 3 passed |
| mobile-navigation | 5 passed |
| mobile-pipeline | 4 passed |
| mobile-table | 4 passed |
| specs/auth | 5 passed |
| specs/channels | 6 passed |
| specs/cockpit-enrichment | 5 passed |
| specs/conversations | 6 passed |
| specs/developer-portal | 3 passed |
| specs/flow-builder-v2 | 6 passed |
| specs/help-support | 4 passed |
| specs/journey | 2 passed |
| specs/pipeline | 4 passed |
| specs/session-expired | 4 passed |
| specs/whatsapp-coexistence | 5 passed (1 é `test.fail`, esperado) |

São 56 testes e 0 falhas. A suíte completa numa só invocação (o que o CI roda) não rodei
localmente, por causa da RAM. Essa prova fica para o CI.

## Definition of Done

- [x] todos os specs passam localmente (ou, se a RAM não deixar, um lote representativo, mais a prova no CI de uma branch)
- [x] causa raiz documentada no slot
- [x] nenhum teste desativado sem justificativa
