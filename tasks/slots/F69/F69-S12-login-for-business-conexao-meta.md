---
id: F69-S12
title: Conectar a Meta falhava na troca do código — login da conexão passa a usar Facebook Login for Business
phase: F69
status: review
priority: critical
estimated_size: S
depends_on: [F69-S02]
blocks: [F69-S03]
source_docs:
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer
claimed_at: 2026-09-22T16:19:37Z
completed_at: 2026-09-22T16:22:10Z

---
# F69-S12 — Conectar a Meta falhava na troca do código

## Objetivo

"Conectar com a Meta" em Configurações → Meta conclui a conexão: o login abre com a configuração do
Facebook Login for Business e o código volta trocável no servidor.

## Contexto

Encontrado em 2026-09-15, na primeira tentativa real de conexão em produção (Rogério). O login na
janela da Meta passou e devolveu o `code`; a troca no servidor falhou:

```
meta.connection.graph  etapa=connect  httpStatus=400  graphCode=100  graphSubcode=36008
```

`100/36008` = "Error validating verification code. Please make sure your redirect_uri is identical to
the one you used in the OAuth dialog request".

**Causa:** `startMetaConnect` (F69-S02) abre `FB.login` com `scope` — o Facebook Login clássico. O app
Leadium é do tipo Business (casos de uso), e a documentação do Facebook Login for Business manda usar
`config_id` no lugar de `scope`, com `response_type: 'code'` e `override_default_response_type: true`.
O Embedded Signup do WhatsApp já usa `config_id`, e a troca do código dele (mesmos parâmetros no
servidor) funciona em produção.

Descartados: app diferente entre web e servidor (os dois usam `META_APP_ID`; `platform_secrets` não
tem `meta_*`), e bloqueio do perfil/empresa (o login na janela passou).

## Escopo

### files_allowed

- `apps/web/features/channels/fb-login.ts`
- `apps/api/src/routes/meta/connections.ts` *(correção 2026-09-22: o log da falha da Meta não trazia a mensagem dela, só os códigos — sem isso o diagnóstico vira adivinhação)*
- `apps/web/features/channels/signup-status.ts`
- `apps/web/features/channels/*.test.ts`
- `apps/web/features/meta-connection/**`
- `apps/web/Dockerfile`
- `infra/docker/docker-compose.prod.yml`
- `.env.example`
- `docs/features/META_INTEGRACAO_PLAN.md`
- `apps/web/features/channels/components/ConnectWizard.tsx` *(correção 2026-09-15: o conectar do Instagram também chama `startMetaConnect` com `scope` e falharia na troca do código do mesmo jeito)*

### files_forbidden

- `apps/api/src/services/channels/whatsapp-connect.ts`

## Escopo (faz)

- Configuração própria da conexão (`NEXT_PUBLIC_META_LOGIN_CONFIG_ID`, vinda de `META_LOGIN_CONFIG_ID`
  no build), separada da do Embedded Signup do WhatsApp.
- `startMetaConnect` usa `config_id` e deixa de mandar `scope`.
- Sem a configuração no build, o botão "Conectar" explica o que falta em vez de abrir um login que
  vai falhar na troca.
- As permissões continuam conferidas no servidor (`GET /me/permissions`) — a configuração define o
  que é pedido; a tela continua dizendo o que falta por caso de uso.
- Passo a passo da configuração no painel da Meta documentado no plano.

## Fora de escopo

- Mudar a troca do código no servidor (os parâmetros já são os que funcionam no WhatsApp).

## Reaberto em 2026-09-22 — `config_id` não bastou

Com a configuração no ar (`META_LOGIN_CONFIG_ID=1072538632222832`, bundle verificado em produção), a
conexão **continuou falhando com o mesmo `100/36008`**, em duas tentativas (16:14:50 e 16:15:37 UTC).
Descartado no caminho:

- **app diferente entre web e servidor** — os dois usam `1241342414558641`;
- **domínio não registrado** — `GET /{app-id}?fields=app_domains` devolve `["app.leadium.com.br"]`;
- **troca fora do padrão** — o exemplo da Meta para Login for Business é exatamente `client_id` +
  `client_secret` + `code`, sem `redirect_uri`, que é o que `connection.ts` faz.

O que sobrou: a chamada do login mandava **`auth_type: 'rerequest'`**, que não existe no exemplo da
Meta. É parâmetro do Login do Facebook clássico. A hipótese: com uma autorização já concedida ao app
(a do WhatsApp, de junho), o `rerequest` leva o SDK ao caminho antigo, e o `code` volta atrelado a uma
`redirect_uri` que a troca documentada não manda. Removido; o teste agora trava os três parâmetros do
exemplo e a ausência do `auth_type`.

Junto: o log da falha passou a trazer a **mensagem** da Meta, não só os códigos — sem ela, a terceira
tentativa de diagnóstico seria adivinhação de novo.

## Definition of Done

- [x] `startMetaConnect` abre `FB.login` com `config_id`, sem `scope` (teste). *(`fb-login.test.ts`)*
- [x] Build sem `META_LOGIN_CONFIG_ID` mostra a configuração faltando e não abre o login (teste). *(`fb-login.test.ts` + `signup-status.test.ts`; o painel lista a variável ausente)*
- [ ] Conexão real em produção conclui e aparece em Configurações → Meta. *(pendente: Rogério criar a configuração no painel da Meta; `META_LOGIN_CONFIG_ID` no `.env` de produção e deploy)*

## Resultado parcial (2026-09-15)

- `@hm/web` 287/287 (7 novos: 3 da configuração de login, 4 do `startMetaConnect`); typecheck e lint limpos.
- O conectar do Instagram (`ConnectWizard.tsx`) também usava `scope` e foi corrigido junto.
- Passo a passo da configuração no painel: `docs/features/META_INTEGRACAO_PLAN.md` §4.1.

## Validação

```bash
pnpm --filter @hm/web test
pnpm typecheck
pnpm lint
```
