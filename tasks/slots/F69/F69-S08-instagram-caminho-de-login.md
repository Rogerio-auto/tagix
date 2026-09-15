---
id: F69-S08
title: Instagram — verificar o caminho de login do caso de uso e alinhar permissões
phase: F69
status: available
priority: high
estimated_size: S
depends_on: [F69-S02]
blocks: [F69-S07]
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: backend-engineer

---
# F69-S08 — Instagram — verificar o caminho de login do caso de uso e alinhar permissões

## Objetivo

Garantir que o login que o produto faz pede exatamente as permissões que o caso de uso do app configura — antes de gravar qualquer screencast.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §3.1. A Meta mantém dois caminhos para o Instagram, com nomes de permissão diferentes (`instagram_basic`/`instagram_manage_messages` no login do Facebook; família `instagram_business_*` no login do Instagram). O código usa o primeiro. Submeter um conjunto e o login pedir o outro reprova, e cada rodada de revisão custa semanas.

## Escopo

### files_allowed

- `apps/web/features/channels/fb-login.ts`
- `apps/api/src/services/channels/instagram-connect.ts`
- `apps/api/src/services/channels/*.test.ts`
- `docs/features/META_INTEGRACAO_PLAN.md`
- `docs/runbooks/meta-app-review-instagram.md`

### files_forbidden

- `packages/channels/src/meta/instagram/webhook.parser.ts`

## Escopo (faz)

- Conferir no painel do app quais permissões o caso de uso "Gerenciar mensagens e conteúdo no Instagram" lista, e registrar com data.
- Conferir na documentação vigente se DM, comentários e publicação estão disponíveis no caminho escolhido.
- Alinhar os escopos do login e a troca de token ao caminho escolhido; registrar a decisão no plano.

## Fora de escopo

- Publicação (F69-S07).

## Definition of Done

- [ ] Lista de permissões do caso de uso registrada com data e print.
- [ ] Escopos do login batem com essa lista; teste cobre a string de escopos.
- [ ] DM e comentários continuam funcionando na conta de teste.
- [ ] Decisão e fontes registradas no plano.

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm lint
```

## Notas

- A régua: o conjunto submetido é idêntico ao conjunto pedido pelo login.
