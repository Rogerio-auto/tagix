---
id: F69-S01
title: Conformidade de plataforma — exclusão de dados, desautorização, política e termos
phase: F69
status: in-progress
priority: critical
estimated_size: M
depends_on: []
blocks: [F69-S02, F69-S10]
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-15T02:02:18Z

---
# F69-S01 — Conformidade de plataforma — exclusão de dados, desautorização, política e termos

## Objetivo

Cumprir os requisitos que valem para **todas** as permissões do app. Sem eles o App Review reprova antes de olhar qualquer caso de uso.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §4. Hoje não existe callback de exclusão de dados nem de desautorização. A Meta chama a URL de exclusão com um `signed_request` (HMAC-SHA256 com o App Secret) quando a pessoa remove o app e pede exclusão, e espera de volta uma URL de acompanhamento e um código de confirmação. URL que devolve 404 na revisão reprova.

## Escopo

### files_allowed

- `apps/api/src/routes/meta/**`
- `apps/api/src/services/meta/signed-request.ts`
- `apps/api/src/services/meta/*.test.ts`
- `apps/api/src/app.ts`
- `packages/db/src/schema/meta_data_requests.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `apps/web/app/**/privacidade/**`
- `apps/web/app/**/termos/**`
- `apps/web/app/**/exclusao-de-dados/**`

### files_forbidden

- `apps/api/src/routes/webhooks/meta.ts`
- `apps/workers/**`

## Escopo (faz)

- Verificação de `signed_request`: separa assinatura e payload, compara HMAC em tempo constante, recusa algoritmo diferente de `HMAC-SHA256`.
- `POST /meta/data-deletion`: registra o pedido, dispara a exclusão dos dados ligados ao `user_id` com escopo de app, responde `{ url, confirmation_code }`.
- `GET /exclusao-de-dados/:codigo`: página pública com o andamento do pedido, sem expor dado de ninguém.
- `POST /meta/deauthorize`: invalida imediatamente os tokens ligados àquele usuário e marca as conexões como desconectadas.
- Páginas públicas de **política de privacidade** e **termos de uso**, sem login, com o que o produto de fato faz com dado da Meta.
- Tabela de pedidos com RLS onde houver workspace e trilha de auditoria.

## Fora de escopo

- A exclusão em si dos dados de negócio do cliente final (contatos, conversas) segue a política de privacidade existente (`services/privacy`).
- Business Verification: é processo no Business Manager, não código.

## Definition of Done

- [ ] `signed_request` com assinatura inválida, adulterada ou algoritmo diferente é recusado; teste cobre os três.
- [ ] Comparação de assinatura em tempo constante.
- [ ] Callback de exclusão devolve `url` e `confirmation_code`; a página de acompanhamento responde sem login e sem PII.
- [ ] Desautorização invalida o token na hora; teste confirma que o envio seguinte não usa o token revogado.
- [ ] Pedido repetido é idempotente pelo `user_id` + código.
- [ ] Política e termos acessíveis sem login e listados no runbook de App Review.
- [ ] Nenhum `APP_SECRET` em log ou resposta.

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm lint
```

## Notas

- A régua: o revisor da Meta testa a URL com um `signed_request` real, e ela funciona na primeira tentativa.
