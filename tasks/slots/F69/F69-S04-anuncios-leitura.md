---
id: F69-S04
title: API de Marketing — leitura: gasto, leads e custo por lead por campanha
phase: F69
status: available
priority: high
estimated_size: L
depends_on: [F69-S02]
blocks: [F69-S05, F69-S06]
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer

---
# F69-S04 — API de Marketing — leitura: gasto, leads e custo por lead por campanha

## Objetivo

O dono vê, no Leadium, quanto gastou, quantos leads vieram e quanto custou cada um — por campanha — sem abrir o Gerenciador de Anúncios.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §5.4. A oferta de US$ 800 inclui gestão de anúncios (`AGENCIA_PLAN` §5); hoje nada disso aparece no produto. Leitura primeiro: mexer em dinheiro vem na S05. Permissões: `ads_read`, `business_management`, com Advanced Access e Business Verification.

## Escopo

### files_allowed

- `packages/channels/src/meta/marketing/**`
- `apps/api/src/services/meta/ads/**`
- `apps/api/src/routes/ads/**`
- `apps/api/src/app.ts`
- `apps/workers/src/ads-sync/**`
- `apps/workers/src/bootstrap/index.ts`
- `packages/db/src/schema/ad_accounts.ts`
- `packages/db/src/schema/ad_insights_daily.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `apps/web/features/ads/**`
- `apps/web/app/(app)/anuncios/**`

### files_forbidden

- `apps/workers/src/outbound/**`

## Escopo (faz)

- Cliente da API de Marketing com paginação completa, limite defensivo, timeout e erros tipados (permanente vs. transitório), no padrão do conector de modelos (F58-S03).
- Contas de anúncio vinculadas à conexão do workspace.
- Sincronização diária de insights por campanha (gasto, impressões, cliques, leads, custo por lead) em `ad_insights_daily`, respeitando o limite de chamadas.
- **Custo por lead cruzado com o funil**: lead que virou agendamento e fechamento, não só lead que preencheu formulário.
- Tela de anúncios mobile-first e card na tela Resultado (F61-S07).

## Fora de escopo

- Pausar, ativar ou mudar orçamento (F69-S05).
- Criar campanha.

## Definition of Done

- [ ] Paginação percorre até o fim com teto e timeout; teste cobre 429 e 5xx.
- [ ] Sincronização idempotente por dia e campanha.
- [ ] Moeda da conta de anúncio respeitada (USD e BRL), sem conversão silenciosa.
- [ ] Custo por lead fechado usa o funil do Leadium e diz de onde veio cada número.
- [ ] Token nunca aparece em log.
- [ ] RLS e isolamento testados.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o dono entende em dez segundos se o anúncio está pagando a própria conta.
