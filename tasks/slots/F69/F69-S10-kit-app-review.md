---
id: F69-S10
title: Kit de App Review — justificativa, roteiro de screencast e conta de teste por permissão
phase: F69
status: available
priority: high
estimated_size: M
depends_on: [F69-S01, F69-S02, F69-S03, F69-S04, F69-S05, F69-S06, F69-S07, F69-S08, F69-S09]
blocks: []
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: backend-engineer

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

- [ ] Toda permissão pedida tem justificativa e roteiro.
- [ ] O conjunto de permissões do runbook é idêntico ao do painel do app, conferido com data.
- [ ] Workspace de demonstração sobe por seed e não contém dado real.
- [ ] Checklist cobre os requisitos do §4 do plano.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm lint
```

## Notas

- A régua: o Rogério grava os screencasts seguindo o roteiro, sem precisar perguntar nada.
