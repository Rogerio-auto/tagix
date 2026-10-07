---
id: F71-S16
title: Tokens de status legíveis no tema claro, TopBar sob a faixa e bottom-nav no claro
phase: F71
status: available
priority: medium
estimated_size: M
ui: true
depends_on: [F71-S10, F70-S32]
blocks: [F71-S17]
source_docs:
  - docs/DESIGN_SYSTEM.md
  - docs/UX_PRINCIPLES.md
  - docs/features/CONTAS_E_CONVITES.md
---
# F71-S16 — Contraste no tema claro, TopBar e "Verifique seu email"

## Objetivo

O tema claro passa em contraste nos tons de status e na navegação, e o shell mobile não desperdiça espaço sob a faixa de conta.

## Contexto

Revisão `/hm-designer` de S07/S08/S09: tons de status sem variante light (ícone de pagamento pálido), item ativo da bottom-nav a 1,36:1 (`#1fff13` sobre branco), `TopBar` mobile soma `pt-safe` mesmo com faixa acima, tela "Verifique seu email" com título "Criar conta" e `heading-order` no menu de Configurações.

## Escopo (faz)

- `packages/design-tokens/src/tokens.css`: variantes light de `--danger` (#c81e1e sugerido), `--warn` (#8a5a00), `--success` (#137a0e) com contraste >= 4.5:1 sobre as superfícies claras, confirmado por cálculo. **Impacto no produto inteiro:** capturas antes/depois das telas que usam status (badges, toasts, faixas, inbox, pipeline, billing, canais) e lista do que mudou.
- `TopBar`: não soma `pt-safe` quando há faixa de conta acima (usa o estado do `account-banner`).
- `BottomNav`: item ativo no claro a 375 px com contraste >= 4.5:1 (token semântico, sem hex no JSX).
- Tela "Verifique seu email": H1 correto (hoje "Criar conta").
- axe `heading-order` do menu de Configurações corrigido.

## Fora de escopo

- Reescrever o DS; tons do tema escuro; modo só leitura nos botões (S17).

### files_allowed

- `packages/design-tokens/src/**`
- `apps/web/shared/components/layout/TopBar.tsx`, `BottomNav.tsx`, `AppLayout.tsx` e testes
- `apps/web/shared/components/account-banner/**` (só expor o estado da faixa, se faltar)
- `apps/web/features/auth/components/**` (só o título de "Verifique seu email")
- `apps/web/features/settings/**` (só `heading-order` do menu)
- testes ao lado e `apps/web/e2e/specs/**`

### files_forbidden

- `apps/api/**`, `packages/db/**`
- `apps/web/shared/components/TopBar*` e `apps/web/features/notifications/**` (F70-S32 toca; esta slot só começa após o merge dela)

## Definition of Done

- [ ] contraste calculado >= 4.5:1 para os três tokens light e para a bottom-nav ativa (valores na nota)
- [ ] sem hex hardcoded novo em JSX
- [ ] teste: `TopBar` não aplica `pt-safe` extra com faixa ativa
- [ ] capturas antes/depois das telas com status, 375/768/1440 dark+light
- [ ] axe sem `color-contrast` nem `heading-order` nas telas tocadas
- [ ] capturas 375/768/1440 em dark e light em `apps/web/e2e/.artifacts/f71-<slot>/`, inspecionadas
- [ ] axe (axe-core) sem violação nova nos componentes tocados
- [ ] revisão `/hm-designer` registrada em "Notas de execução" com veredito

## Validação

```bash
pnpm --filter @hm/design-tokens typecheck
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
node --env-file=.env apps/web/node_modules/vitest/vitest.mjs run --root apps/web --maxWorkers=1
python scripts/slot.py status --phase F70
```

## Notas

- Agente: `frontend-engineer` + `/hm-designer`.
- Depende de **F70-S32** (status `available` no board em 2026-10-07; mesmo `TopBar`).
