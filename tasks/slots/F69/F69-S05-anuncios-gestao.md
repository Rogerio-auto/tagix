---
id: F69-S05
title: API de Marketing — gestão: pausar, ativar e ajustar orçamento com confirmação e trilha
phase: F69
status: available
priority: medium
estimated_size: M
depends_on: [F69-S04]
blocks: [F69-S09]
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer

---
# F69-S05 — API de Marketing — gestão: pausar, ativar e ajustar orçamento com confirmação e trilha

## Objetivo

Operar o essencial da campanha pelo Leadium — pausar, ativar e ajustar orçamento — com confirmação explícita e trilha de quem mudou o quê.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §5.4. É dinheiro do cliente. Mudança sem trilha é o jeito mais rápido de perder um contrato. Permissão: `ads_management` com Advanced Access.

## Escopo

### files_allowed

- `packages/channels/src/meta/marketing/**`
- `apps/api/src/services/meta/ads/**`
- `apps/api/src/routes/ads/**`
- `packages/db/src/schema/ad_changes.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `apps/web/features/ads/**`
- `packages/shared/src/permissions.ts`

### files_forbidden

- `apps/workers/src/outbound/**`

## Escopo (faz)

- Pausar e ativar campanha e conjunto; ajustar orçamento diário ou vitalício.
- Confirmação com o valor antes e depois, na moeda da conta.
- Permissão própria (`ads.manage`) separada de `ads.view`.
- `ad_changes`: quem, quando, o quê, valor anterior e novo, e a resposta da Meta.
- Teto de variação de orçamento por ação configurável por workspace.

## Fora de escopo

- Criação de campanha, conjunto ou criativo.
- Ação feita por agente de IA (F69-S09).

## Definition of Done

- [ ] Toda mutação exige confirmação e grava `ad_changes`.
- [ ] Membro sem `ads.manage` recebe 403; teste cobre.
- [ ] Variação acima do teto é recusada com explicação.
- [ ] Falha da Meta não deixa o Leadium mostrando estado que não aconteceu.
- [ ] Idempotência: clique duplo não aplica duas vezes.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: qualquer mudança de orçamento pode ser explicada ao cliente com data, autor e motivo.
