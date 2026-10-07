---
id: F71-S17
title: Botões de escrita desabilitados com tooltip no modo só leitura, por feature
phase: F71
status: available
priority: medium
estimated_size: L
ui: true
depends_on: [F71-S16]
blocks: []
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
---
# F71-S17 — Modo só leitura nos botões de escrita

## Objetivo

Empresa em modo só leitura mostra os botões de escrita desabilitados e explica o porquê, em vez de deixar a pessoa clicar e tomar um 402.

## Contexto

S08 exportou `useIsReadOnly` e `READ_ONLY_TOOLTIP` (`apps/web/shared/components/account-banner/`) mas não os aplicou às features (fora da fronteira). A guarda real continua no servidor (S06, 402); isto é só UX.

## Escopo (faz)

Aplicar o hook aos botões de escrita **principais** (criar, enviar, salvar, excluir, importar) com tooltip acessível (`aria-disabled` + descrição, não só `disabled`), por sub-escopo e um commit cada:
- A: inbox (enviar mensagem, atribuir, encerrar) e contatos
- B: pipeline/deals e produtos/catálogo
- C: flows e campanhas
- D: agentes e configurações (membros, convites, canais)
- Wrapper compartilhado (`ReadOnlyButton`) em `apps/web/shared/components/account-banner/` se reduzir repetição.

Se passar de L, o orchestrator divide em S17a..d pelos sub-escopos.

## Fora de escopo

- Qualquer mudança no servidor; billing (continua habilitado); tokens de cor (S16).

### files_allowed

- `apps/web/features/inbox/**`, `apps/web/features/contacts/**`, `apps/web/features/pipeline/**`, `apps/web/features/catalog/**`
- `apps/web/features/flows/**`, `apps/web/features/campaigns/**`, `apps/web/features/agents/**`, `apps/web/features/settings/**`, `apps/web/features/members/**`
- `apps/web/shared/components/account-banner/**`
- (somente botões de ação e testes ao lado)

### files_forbidden

- `apps/api/**`, `packages/**`, `apps/web/shared/components/layout/**` (S16)

## Definition of Done

- [ ] por feature: teste de componente com `useIsReadOnly = true` → botão `aria-disabled` com `READ_ONLY_TOOLTIP`; `false` → funciona normal
- [ ] botão desabilitado continua focável e o tooltip é lido por leitor de tela
- [ ] leitura e navegação seguem funcionando em só leitura (e2e)
- [ ] lista final das features cobertas e das deixadas de fora, nas Notas
- [ ] capturas 375/768/1440 em dark e light em `apps/web/e2e/.artifacts/f71-<slot>/`, inspecionadas
- [ ] axe (axe-core) sem violação nova nos componentes tocados
- [ ] revisão `/hm-designer` registrada em "Notas de execução" com veredito

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
node --env-file=.env apps/web/node_modules/vitest/vitest.mjs run --root apps/web --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer` + `/hm-designer`.
- Depende da S16 (tokens e contraste do estado desabilitado no claro).
