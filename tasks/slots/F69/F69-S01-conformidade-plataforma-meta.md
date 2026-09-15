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
- `apps/web/app/(public)/layout.tsx`
- `apps/web/middleware.ts`

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

- [x] `signed_request` com assinatura inválida, adulterada ou algoritmo diferente é recusado; teste cobre os três.
- [x] Comparação de assinatura em tempo constante.
- [x] Callback de exclusão devolve `url` e `confirmation_code`; a página de acompanhamento responde sem login e sem PII.
- [ ] Desautorização invalida o token na hora; teste confirma que o envio seguinte não usa o token revogado. — **parcial:** o callback registra e chama `revokeForMetaUser` (testado); a invalidação efetiva depende do ID de usuário que a **F69-S02** passa a guardar.
- [x] Pedido repetido é idempotente pelo `user_id` + código.
- [x] Política e termos acessíveis sem login e listados no runbook de App Review.
- [x] Nenhum `APP_SECRET` em log ou resposta.

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm lint
```

## Notas

- A régua: o revisor da Meta testa a URL com um `signed_request` real, e ela funciona na primeira tentativa.

## Decisões tomadas na execução (2026-09-14)

1. **A assinatura é conferida antes de interpretar o payload.** São rotas públicas por definição;
   JSON de origem desconhecida não chega nem ao `JSON.parse` antes de o HMAC bater. Comparação em
   tempo constante.
2. **Sem App Secret, recusa com 503 — nunca aceita por omissão.** Aceitar sem conseguir provar a
   origem abriria exclusão de dados e desconexão para qualquer um.
3. **Hoje todo pedido termina em `no_data`, e isso é a verdade.** O Leadium ainda não guarda o ID
   de usuário da Meta em lugar nenhum: os tokens dos canais são de página e de conta de WhatsApp,
   não de pessoa. As portas `deleteForMetaUser` e `revokeForMetaUser` existem e têm teste; a
   F69-S02 passa a registrar o ID na conexão e a ligá-las. Responder "apagado" sem ter o que
   apagar seria mentir num registro de conformidade.
4. **Pedido repetido devolve o mesmo código.** A Meta pode repetir a chamada; dois registros para
   uma vontade só confundiriam a página de acompanhamento.
5. **Falha de remoção vira `failed`, visível, e a resposta à Meta ainda sai.** Pedido de exclusão
   não pode sumir.
6. **A página de acompanhamento mostra só o estado.** O código é público (a Meta mostra ao
   usuário) e não pode virar forma de descobrir quem pediu; teste confirma que o ID não aparece.
7. **Tabela de plataforma, sem RLS de tenant**, como `webhook_events`: o pedido não tem workspace.
   Não guarda o que foi apagado.
8. **Páginas públicas num grupo `(public)` e liberadas no `middleware.ts`**, que entrou em
   `files_allowed` durante a execução.
9. **Política e termos descrevem o uso real, caso de uso por caso de uso** — o revisor compara o
   texto com o screencast. Os termos registram as regras que o código já aplica (consentimento,
   supressão, aprovação humana de gasto), para termo e comportamento não se contradizerem.

## Pendente antes da submissão (não é código)

- Razão social, CNPJ/EIN e endereço do controlador na política e nos termos.
- Revisão jurídica dos dois textos (LGPD e leis estaduais americanas).
- Cadastrar no painel do app: `https://api.leadium.com.br/meta/data-deletion` (exclusão),
  `https://api.leadium.com.br/meta/deauthorize` (desautorização),
  `https://app.leadium.com.br/privacidade` e `https://app.leadium.com.br/termos`.

## Resultado

- 22 testes novos (9 do `signed_request`, 13 das rotas). Typecheck limpo em `@hm/db`, `@hm/api` e
  `@hm/web`. Lint: 0 erros.
