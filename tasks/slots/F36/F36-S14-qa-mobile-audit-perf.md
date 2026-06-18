---
id: F36-S14
title: QA mobile + audit de UX + performance (fechamento)
phase: F36
status: available
priority: medium
estimated_size: M
depends_on:
  - F36-S02
  - F36-S03
  - F36-S04
  - F36-S05
  - F36-S06
  - F36-S07
  - F36-S08
  - F36-S09
  - F36-S10
  - F36-S11
  - F36-S12
  - F36-S13
blocks: []
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
  - docs/UX_PRINCIPLES.md
  - docs/MOBILE_UX.md
agent_id: qa-engineer
---
# F36-S14 — QA mobile + audit + performance

## Objetivo

Fechar a F36: e2e em viewport mobile dos fluxos-chave, auditoria do checklist de UX (UX_PRINCIPLES §4 + princípios mobile do MOBILE_UX) em todas as telas, e orçamento de performance mobile — com regressão desktop zero.

## Contexto

Slot de fechamento; depende de toda a F36. Valida a experiência mobile ponta a ponta e consolida o relatório.

## Escopo (faz)

- **`apps/web/e2e/mobile-*.spec.ts`** (novos) — Playwright em viewport mobile (ex.: Pixel/iPhone) cobrindo fluxos determinísticos: login → bottom nav → inbox (lista→thread→cockpit sheet) → trocar agente; pipeline (estágio→card→mover); tabela→cards + filtro em sheet (contatos); abrir um sheet e fechar por swipe/Esc.
- **`docs/audits/MOBILE_AUDIT.md`** (novo) — varredura tela-a-tela contra o checklist (alvos ≥44px, inputs 16px, safe-area, empty/loading/error, sheets, sem scroll-x quebrado), Lighthouse mobile por rota-chave (meta ≥ 90 performance/accessibility), e checklist de regressão desktop.

## Fora de escopo

- Implementação/ajuste de telas (volta como follow-up pro slot dono se achar bug).
- Editar UX_PRINCIPLES/MOBILE_UX (S01 é dono).

## Arquivos permitidos

- `apps/web/e2e/mobile-*.spec.ts`
- `docs/audits/MOBILE_AUDIT.md`

## Arquivos proibidos

- Qualquer arquivo de implementação (S01–S13)
- `docs/UX_PRINCIPLES.md`, `docs/MOBILE_UX.md`

## Definition of Done

- [ ] e2e mobile cobre os fluxos-chave (ou documenta honestamente o que o ambiente não roda — ver nota de hidratação do host).
- [ ] `MOBILE_AUDIT.md` com a varredura tela-a-tela + Lighthouse mobile + regressão desktop.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Audita TODO o checklist UX_PRINCIPLES §4 + princípios mobile (§4 do plano): thumb-first, sheet, tabela→cards, alvos, safe-area, gestos com equivalente de toque, PWA instalável.

## Notas

GOTCHA de ambiente: a suíte e2e pode não rodar verde neste host (app não hidrata no headless-shell — ver memória do projeto). Se for o caso, garantir specs válidos (typecheck) + audit manual via build/preview, e marcar a execução e2e como pendente de ambiente. NÃO inventar verde.
