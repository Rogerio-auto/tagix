---
id: F69-S12
title: Conectar a Meta falhava na troca do código — login da conexão passa a usar Facebook Login for Business
phase: F69
status: in-progress
priority: critical
estimated_size: S
depends_on: [F69-S02]
blocks: [F69-S03]
source_docs:
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer
claimed_at: 2026-09-15T15:52:51Z

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
- `apps/web/features/channels/signup-status.ts`
- `apps/web/features/channels/*.test.ts`
- `apps/web/features/meta-connection/**`
- `apps/web/Dockerfile`
- `infra/docker/docker-compose.prod.yml`
- `.env.example`
- `docs/features/META_INTEGRACAO_PLAN.md`

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

## Definition of Done

- [ ] `startMetaConnect` abre `FB.login` com `config_id`, sem `scope` (teste).
- [ ] Build sem `META_LOGIN_CONFIG_ID` mostra a configuração faltando e não abre o login (teste).
- [ ] Conexão real em produção conclui e aparece em Configurações → Meta.

## Validação

```bash
pnpm --filter @hm/web test
pnpm typecheck
pnpm lint
```
