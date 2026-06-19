---
id: F43-S05
title: First-run — welcome + pesquisa + escolha de nicho (aplica blueprint)
phase: F43
status: available
priority: high
estimated_size: M
depends_on: [F43-S04]
blocks: [F43-S07]
agent_id: frontend-engineer
source_docs:
  - docs/features/ONBOARDING.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.8/3.x — wizard multi-step (boas-vindas → pesquisa → nicho) com progresso e salvamento entre steps."
  - "Aplica 2.7 — botão 'Criar' em loading + disabled; toast de sucesso/erro ao fim."
  - "Aplica 2.11 — erro em 3 partes (o quê/por quê/o que fazer)."
  - "Aplica 2.6 — primeira sessão é o anti-empty-state: guia o próximo passo em vez de tela vazia."
  - "Mobile (MOBILE_UX §2.3): em < md o wizard vira sheet, não modal lateral."
---

# F43-S05 — First-run (welcome + pesquisa + nicho)

> **source_docs:** `docs/features/ONBOARDING.md` §3.2; `docs/UX_PRINCIPLES.md`
> **depends_on:** F43-S04 (API de apply/survey/state)
> **blocks:** F43-S07 (monta o provider de shell que o tour usa)

## Objetivo

No primeiro login (`onboarding.niche_key == null`), guiar o usuário por um wizard:
boas-vindas → mini-pesquisa → escolher/confirmar nicho → aplicar o blueprint do nicho.

## Contexto

Reaproveita e **expande** o `NicheOnboardingWizard` órfão (hoje 2 nichos, sem mount). Passa a
suportar os 7 nichos (de `GET /api/onboarding/state`/registry) e a mini-pesquisa.

## Escopo (faz)

- Expandir `apps/web/features/onboarding/` para um wizard multi-step (welcome, survey, niche).
- `OnboardingProvider` (client) montado no shell do app que, com base no estado, abre o wizard só
  no primeiro acesso; chama `PUT /survey` e `POST /apply`.
- Renderiza um **stub** `GuidedTourMount` (no-op) que F43-S07 preencherá — para o ponto de montagem
  do tour já existir no shell.
- Mini-pesquisa: tipo de negócio, tamanho do time, objetivo (sugere o nicho).
- Empty/loading/error states; mobile = sheet.

## Fora de escopo

- Checklist (F43-S06). Engine/conteúdo de tour (F43-S07/S08).

## Arquivos permitidos

- `apps/web/features/onboarding/**`
- `apps/web/shared/components/tour/GuidedTourMount.tsx`
- `apps/web/app/(app)/layout.tsx`

## Arquivos proibidos

- `apps/web/features/dashboard/**` (F43-S06/S08)
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Wizard só aparece no primeiro acesso; ao concluir, grava estado e não reaparece.
- [ ] `apply` dispara feedback (loading + toast); erros em 3 partes.
- [ ] Checklist UX (UX_PRINCIPLES §4) relevante marcado; mobile = sheet.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. e2e não hidrata neste host (memória) — validar por build/typecheck/lint/unit.
- DS v2: tokens semânticos, zero hex em JSX.
