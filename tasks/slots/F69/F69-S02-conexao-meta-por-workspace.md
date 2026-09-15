---
id: F69-S02
title: Conexão Meta por workspace — permissões dos casos de uso, token cifrado e reconexão guiada
phase: F69
status: in-progress
priority: critical
estimated_size: L
depends_on: [F69-S01]
blocks: [F69-S03, F69-S04, F69-S08]
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer
claimed_at: 2026-09-15T02:23:48Z

---
# F69-S02 — Conexão Meta por workspace — permissões dos casos de uso, token cifrado e reconexão guiada

## Objetivo

Um jeito só de o cliente conectar a Meta ao Leadium, pedindo as permissões dos casos de uso que ele vai usar, guardando o que foi concedido e dizendo com clareza quando falta alguma.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §5.6. Hoje cada canal tem o próprio login: o WhatsApp usa Embedded Signup com `config_id`, o Instagram usa `FB.login` com escopo fixo em `fb-login.ts`. Não existe registro de quais permissões o usuário concedeu, então uma permissão negada só aparece como erro no meio de uma ação. Com 50 clientes (decisão de 2026-09-14), a conexão precisa ser autosserviço.

## Escopo

### files_allowed

- `packages/db/src/schema/meta_connections.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/meta-connections.ts`
- `packages/db/src/index.ts`
- `packages/db/drizzle/**`
- `packages/db/src/*.test.ts`
- `apps/api/src/services/meta/**`
- `apps/api/src/routes/meta/**`
- `apps/api/src/app.ts`
- `apps/web/features/meta-connection/**`
- `apps/web/features/channels/fb-login.ts`
- `apps/web/features/channels/components/ConnectWizard.tsx`
- `apps/api/src/routes/channels/index.ts`
- `apps/api/src/routes/meta/data-requests.ts`
- `apps/web/app/(app)/settings/meta/**`
- `apps/web/features/channels/types.ts`
- `apps/web/features/channels/queries.ts`
- `apps/web/features/settings/shell/registry.tsx`

### files_forbidden

- `apps/workers/src/outbound/**`
- `packages/shared/src/consent.ts`

## Escopo (faz)

- `meta_connections` (workspace, usuário Meta, Business, token de longa duração cifrado, expiração, **permissões concedidas e negadas**, ativos vinculados: páginas, contas de anúncio, contas IG, WABAs) com RLS.
- Troca de código por token no servidor; token nunca vai ao navegador.
  **Achado de 2026-09-14:** hoje `POST /api/channels/instagram/accounts` devolve o
  `pageAccessToken` ao navegador, que o reenvia em `POST /api/channels/instagram/connect`
  (`apps/api/src/routes/channels/index.ts`). O token de página trafega pelo cliente e fica
  exposto a qualquer extensão ou script na página. Este slot passa a guardar o token no
  servidor entre os dois passos (referência opaca e de curta duração no lugar do token).
- **Registrar o ID de usuário com escopo do app** na conexão, e ligar as portas
  `deleteForMetaUser` e `revokeForMetaUser` da F69-S01 — sem isso os callbacks de exclusão e
  desautorização continuam sem ter o que remover.
- Leitura de `/me/permissions` após conectar e antes de cada operação sensível.
- Tela de conexão por caso de uso: o cliente escolhe o que quer ligar (leads, anúncios, Instagram) e vê o que cada um pede.
- Estado de saúde: token perto de expirar, permissão revogada, ativo removido — com botão de reconectar pedindo só o que falta.

## Fora de escopo

- Usar a conexão para leads, anúncios ou publicação (S03, S04, S07).
- Migrar o Embedded Signup do WhatsApp, que funciona e está em produção.

## Definition of Done

- [x] Token de longa duração cifrado em repouso; teste confirma que nenhuma rota devolve o token.
- [x] Permissões concedidas e negadas persistidas e atualizadas ao reconectar.
- [x] Ação que exige permissão ausente responde com qual falta e como resolver, em vez de erro genérico.
- [x] RLS: workspace A não lê a conexão de B; teste cobre.
- [x] Reconexão pede apenas as permissões que faltam.
- [x] Desautorização (F69-S01) marca a conexão como desconectada.
- [x] Nenhuma rota devolve token de página ou de usuário ao navegador — inclusive o fluxo atual do Instagram; teste cobre.
- [x] Callback de exclusão da F69-S01 remove conexões e tokens ligados ao ID de usuário; teste de ponta a ponta.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o dono conecta sozinho, e quando algo quebra a tela diz exatamente o quê.

## Decisões tomadas na execução (2026-09-14)

1. **O navegador só entrega o `code`.** A troca por token de longa duração acontece no servidor, com
   o App Secret, e o token vai direto para o banco, cifrado. O `code` sozinho não serve para nada
   sem o App Secret.
2. **O fluxo do Instagram deixou de trafegar token.** Antes, `POST /api/channels/instagram/accounts`
   recebia o token de usuário do navegador e devolvia o token de cada página para o navegador
   reenviar. Agora o navegador conhece só o id da conexão, e o token da página é obtido no servidor.
3. **O servidor confere que a página escolhida é da pessoa.** Ao conectar o Instagram, a conta é
   buscada de novo na Meta pela conexão; `pageId` que não está entre as páginas que a pessoa
   administra é recusado (422). Aceitar o id enviado pelo cliente permitiria ligar ao workspace a
   página de outra pessoa.
4. **Segredo vindo do navegador saiu do contrato.** O `appSecret` que o cliente podia enviar era
   gravado cifrado e nunca lido por código nenhum.
5. **O login antigo que devolvia token ao navegador foi removido**, não mantido "por
   compatibilidade": código que entrega token ao cliente, parado no repositório, é a próxima pessoa
   usando-o sem saber.
6. **Uma lista de permissões só.** `services/meta/permissions.ts` é a fonte; a tela lê por
   `GET /api/meta/use-cases`. Uma cópia no navegador faria a primeira renomeação da Meta pedir um
   conjunto no login e exigir outro na checagem de saúde.
7. **Permissão é conferida antes de chamar a Meta.** Falta de permissão vira resposta 409 com o que
   autorizar, em vez de erro da Graph no meio da conexão.
8. **Reconectar acumula casos de uso** (união no `upsert`). Quem conecta anúncios não perde os leads
   que já tinha.
9. **Reconectar pede só o que falta**, com `auth_type: 'rerequest'` para a Meta perguntar de novo o
   que foi recusado. Token expirado ou revogado — sem nada faltando — pede o conjunto inteiro.
10. **Os callbacks da Meta atravessam workspaces só por duas funções `SECURITY DEFINER`**
    (`meta_forget_user`, `meta_revoke_user`), no padrão da 0068: cada uma recebe só o ID de usuário e
    devolve só uma contagem. Execução negada a `PUBLIC`, com teste.
11. **Revogar apaga o token e mantém o registro**, para a tela explicar o que aconteceu. Conexão
    ativa sem token é estado impossível, garantido por CHECK no banco.
12. **Cada leitura de ativos falha sozinha.** Sem permissão de anúncios, as páginas continuam
    aparecendo.
13. **Resposta da releitura montada campo a campo**, sem espalhar a linha do banco — é exatamente
    assim que um token acaba numa resposta sem ninguém notar.

## Resultado

- 25 testes de serviço (`signed-request`, `permissions`, `connection`), 37 de rotas (`meta` e
  `channels`), 10 de integração contra Postgres (RLS, `SECURITY DEFINER`, CHECK, união de casos de
  uso). Suíte web 280/280. Typecheck limpo em `@hm/db`, `@hm/api` e `@hm/web`. Lint: 0 erros.
- Migration `0079`: `meta_connections` com RLS e as duas funções dos callbacks.

## Nota de operação

O build de produção do web falhou uma vez por falta de memória no worker do Next (Docker Desktop
recém-ligado e testes rodando em paralelo). Rodado de novo sozinho, com
`NODE_OPTIONS=--max-old-space-size=6144`.

