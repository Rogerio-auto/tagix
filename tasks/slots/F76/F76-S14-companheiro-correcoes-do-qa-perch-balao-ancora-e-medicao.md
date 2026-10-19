---
id: F76-S14
title: Companheiro das telas de acesso — correções do QA (perch sem cobrir o painel, balão sem cobrir o eyebrow, âncora do convite, medição sob transform)
phase: F76
status: in-progress
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F76-S13]
blocks: []
source_docs:
  - docs/design/auth-companion/SPEC.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
agent_id: frontend-engineer
claimed_at: 2026-10-19T22:37:22Z

---
# F76-S14 — Correções do QA do companheiro

## Objetivo

O QA do F76-S13 (capturas reais, build de produção) reprovou quatro pontos visíveis. Corrigir **por construção**, não por
gambiarra de coordenada, e fazer virar verde os testes `test.fail` que documentam os bugs.

## Achados e decisão de design (do Opus)

- **A2 — o `perch` cobre o texto do painel editorial** (31 de 32 combinações campo × viewport; em 1024 px cobre o meio dos
  pilares; em 1440 px fica sobre "Toda"). Hoje: `PERCH_X = 72` fixo (`CompanionFigure.tsx`, `measure`) sobre o padding do
  `BrandPanel`. **Decisão:** o perch ganha uma **faixa própria no fluxo do painel**: um elemento real (`CompanionPerch`)
  entre o eyebrow e o bloco editorial, `flex-1 min-h-14` (reserva ≥ 56 px em qualquer altura), sem texto dentro. O
  personagem fica **dentro** dessa faixa: `y` acompanha o campo focado **limitado à faixa**; `x` à esquerda da faixa
  (alinhado ao início do texto, `left = padding do painel`), olhando para o formulário. Como a faixa é caixa de layout, é
  impossível sobrepor texto, em qualquer viewport. Remover `PERCH_X`; o motor lê o retângulo da faixa, não uma constante.
  Se a faixa tiver menos de 48 px de altura (viewport muito baixa), o personagem fica no posto `heading` (não voa para o
  painel).
- **A1 — o balão cobre o eyebrow no desktop** (`reset-sent`: "O link já está a caminho." sobre "RECUPERAÇÃO DE ACESSO").
  Hoje `placement='start'` (à esquerda da figura). **Decisão:** no posto `heading` do desktop o balão vai **acima da
  figura** (`placement='top'`), rabicho apontando para baixo, alinhado à direita da figura; há ≥ 40 px livres ali
  (padding do `main`). No mobile (posto `inline`) continua abaixo e à direita, como hoje. Verificar que não cobre o `Logo`
  nem sai da coluna de 25rem.
- **A3 — `measure()` lê posição com transform de ancestral em andamento** (`AuthStepTransition` 4 px, `hm-rise` 8 px) e não
  remede ao fim: figura 0,4–0,9 px (às vezes 8 px) fora da linha. **Decisão:** remedir quando as animações dos ancestrais
  terminam (`getAnimations({subtree})` filtrado pelos ancestrais, `Promise.allSettled(finished)`) e uma vez após a troca de
  etapa; ou medir sem o transform dos ancestrais. Escolha a mais simples que passe estável; documente.
- **A4 — convite sem âncora `heading`.** `InviteView` tem `<header>` próprio sem `AuthHeading`; o personagem monta invisível
  e **some** no sucesso (celebração perdida). **Decisão:** registrar a âncora `heading` no `<header>` do `InviteView`
  (`useCompanionAnchor('heading')`) e fazer o `measure` achar a linha do eyebrow de forma robusta (primeiro `<p>`
  descendente do header, com fallback para `firstElementChild`). Além disso, **fallback de segurança no motor**: se um posto
  não tem âncora, usar outro posto visível (perch/inline) em vez de `visibility:hidden`.

## Escopo (faz)

- Corrigir A1–A4 conforme acima.
- Remover as marcas `test.fail` correspondentes em `apps/web/e2e/specs/auth-companion.spec.ts` (viram testes normais) e
  acrescentar asserções: perch nunca intersecta texto do painel (1024/1280/1440/1920 × campos), balão nunca intersecta
  eyebrow, convite celebra visível.
- Atualizar `docs/design/auth-companion/SPEC.md` (posto `perch` por faixa; balão `top` no desktop).

## Fora de escopo

- Nova arte; novos estados; mudar o contrato público (`contract.ts` só se for indispensável — reportar antes).

### files_allowed

- `apps/web/features/auth/companion/**` (exceto `art/**`)
- `apps/web/app/(auth)/layout.tsx`
- `apps/web/features/invites/components/InviteView.tsx`
- `apps/web/e2e/specs/auth-companion.spec.ts`
- `apps/web/e2e/perf/auth-companion.perf.spec.ts`
- `docs/design/auth-companion/SPEC.md`

### files_forbidden

- `apps/web/features/auth/companion/art/**`

## Definition of Done

- [ ] os 4 `test.fail` removidos e verdes (A1, A2 em 1024/1440; nenhum texto do painel coberto)
- [ ] 7 execuções seguidas do spec sem falha intermitente de alinhamento (A3) — ou causa raiz documentada
- [ ] convite: o personagem aparece e celebra no sucesso
- [ ] peso gz total ≤ 12 KB (meta) — medido pelo perf spec; zero regressão de privacidade/CLS/LCP
- [ ] typecheck, eslint `--max-warnings 0`, vitest do módulo e e2e (`E2E_SERVER=start`) verdes

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm exec eslint --max-warnings 0 apps/web/features/auth/companion apps/web/features/invites
pnpm --filter @hm/web exec vitest run --maxWorkers=1 features/auth features/invites
```

## Notas

- Agente: `frontend-engineer` (Sonnet), com as decisões de design acima já tomadas. Rodar o e2e com `E2E_SERVER=start`
  após `pnpm --filter @hm/web build` (o padrão `dev` sobrescreveria o `.next` de produção).
