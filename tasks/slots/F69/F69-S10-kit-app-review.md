---
id: F69-S10
title: Kit de App Review — justificativa, roteiro de screencast e conta de teste por permissão
phase: F69
status: in-progress
priority: high
estimated_size: M
depends_on: [F69-S01, F69-S02, F69-S03, F69-S04, F69-S05, F69-S06, F69-S07, F69-S08, F69-S09]
blocks: []
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-10-07T14:09:55Z

---
# F69-S10 — Kit de App Review — justificativa, roteiro de screencast e conta de teste por permissão

## Objetivo

Deixar pronto tudo o que o Rogério precisa para submeter o app: por permissão, a justificativa, o roteiro do screencast, a conta de teste e o fluxo demonstrável.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §3 e §4. Advanced Access vale por permissão, e cada uma precisa de justificativa e screencast do fluxo inteiro. O runbook atual cobre só o Instagram (`docs/runbooks/meta-app-review-instagram.md`).

## Escopo

### files_allowed

- `docs/runbooks/meta-app-review.md`
- `docs/runbooks/meta-app-review-instagram.md`
- `docs/app-review/**`
- `packages/db/src/seed/**`
- `apps/api/src/routes/dev/**`

### files_forbidden

- `apps/web/features/**`

## Escopo (faz)

- Runbook único de App Review para os cinco casos de uso (substitui o do Instagram, que vira seção).
- Por permissão: texto de "como o app usa", roteiro de screencast passo a passo, dados de teste, o que o revisor precisa ver.
- Workspace de demonstração com dados fictícios e contas de teste, reproduzível por seed.
- Checklist de pré-submissão: Business Verification, URLs públicas, webhook, permissões conferidas no painel.

## Fora de escopo

- Submeter o app (é do Rogério).

## Definition of Done

- [x] Toda permissão pedida tem justificativa e roteiro. — **lote 1** (WhatsApp, Instagram mensagens/comentários, leads): ficha com texto em inglês para o formulário em `docs/app-review/permissoes.md`, roteiro cena a cena em `screencasts.md`. Lotes 2 e 3 (Marketing, publicação, MCP) não têm feature para mostrar: o molde está no kit e a ficha nasce com o slot de cada um (plano §6).
- [ ] O conjunto de permissões do runbook é idêntico ao do painel do app, conferido com data. — 🧑 **Rogério:** o painel da Meta só abre com a conta dele. Tabela pronta para preencher em `docs/runbooks/meta-app-review.md` §3. Do lado do código, o kit já bate com `permissions.ts` e aponta as duas divergências achadas (`ads_management` em leads sem uso visível; `pages_messaging` do runbook antigo, que o código não pede).
- [x] Workspace de demonstração sobe por seed e não contém dado real. — `packages/db/src/seed/app_review_demo.ts` (+ `.run.ts`): contatos com DDD 00, e-mails `example.com`, funil e negócios marcados `demo_app_review`, sem canal. Idempotente; teste no Postgres sob RLS (1ª rodada cria, 2ª não cria nada). A conta nasce pelo cadastro normal (o seed não toca o provedor de auth).
- [x] Checklist cobre os requisitos do §4 do plano. — `docs/app-review/README.md` §3, com o estado conferido em produção em 2026-10-07 (privacidade/termos 200, webhook 403 com token errado, exclusão e desautorização 400 sem assinatura) e os `curl` para repetir na VPS nova no runbook §2.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm lint
```

## Notas

- A régua: o Rogério grava os screencasts seguindo o roteiro, sem precisar perguntar nada.

## Entrega (2026-10-07)

Dependências S03–S09 não satisfeitas: o slot foi assumido com `--force` porque o kit do **lote 1**
só depende do que já existe (WhatsApp, Instagram mensagens/comentários, leads S03/S13). Submeter é
**depois do deploy na VPS nova**: revisor e callbacks batem em produção, e a produção atual está
congelada num commit antigo.

| Arquivo | Conteúdo |
| --- | --- |
| `docs/app-review/README.md` | Quando submeter, lotes, requisitos do §4 com estado, pendências, ordem |
| `docs/app-review/permissoes.md` | Ficha por permissão do lote 1 + texto em inglês para o formulário + molde |
| `docs/app-review/screencasts.md` | Roteiros W1–W3, I1–I3, L1–L2 com os rótulos reais da UI |
| `docs/app-review/conta-de-teste.md` | Conta do revisor, seed, contas de teste da Meta, instruções ao revisor |
| `docs/runbooks/meta-app-review.md` | Submissão: pré-requisitos, `curl` de conferência, tabela do painel, pós |
| `docs/runbooks/meta-app-review-instagram.md` | Aponta para o kit; `pages_messaging` marcado como "não pedir" |
| `packages/db/src/seed/app_review_demo{,.run,.test}.ts` | Seed de demonstração |
| `packages/db/src/seed/target-guard.ts` | Guarda de alvo extraída do seed da Arcada, parametrizada por prefixo (Arcada mantém a API e os 14 testes) |

**Correção de texto achada na conferência:** remover a Página no Leadium **não** cancela a inscrição
na Meta (o `DELETE /api/meta/lead-sources/:id` só para de processar). O texto do formulário diz só
o que o código faz.

### Pendências fora da fronteira (para o Rogério decidir)

1. **`ads_management` no caso de uso `leads`** (`apps/api/src/services/meta/permissions.ts`): nenhuma
   tela de leads usa. Recomendação: tirar de `leads` e pedir no lote 2 com o F69-S05.
2. **F69-S08** fecha antes de gravar o Instagram; sem ele, o lote 1 vai só com WhatsApp + leads.

## Validação (2026-10-07)

- `pnpm --filter @hm/db typecheck` ✅ · eslint nos arquivos tocados ✅
- `pnpm --filter @hm/db test` → 25 arquivos / 283 testes ✅ (inclui os 7 novos do seed)
