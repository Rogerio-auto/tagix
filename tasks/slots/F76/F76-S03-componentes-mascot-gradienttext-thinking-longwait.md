---
id: F76-S03
title: Componentes do personagem no @hm/ui — Mascot, MascotStage, GradientText, Thinking, LongWait e tokens por marca
phase: F76
status: blocked
priority: critical
estimated_size: L
model: opus
ui: true
depends_on: [F76-S02]
blocks: [F76-S04, F76-S05, F76-S06, F76-S07, F75-S10]
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
  - docs/design/copilot-botao-animacao.md
agent_id: frontend-engineer
---
# F76-S03 — Componentes do personagem no `@hm/ui`

## Objetivo

O design system ganha os componentes públicos do personagem e das esperas — `Mascot`, `MascotStage`,
`GradientText`, `Thinking`, `LongWait` — com os contratos exatos da spec §6, tokens por tema e marca com contraste
testado, movimento reduzido e pausa fora da tela, dentro do orçamento de peso. A F74 (Copiloto) e a F75
(assistente) consomem daqui.

## Contexto

Spec §3.2–§3.4 e §6; ADR-006. Tecnologia decidida no ADR-006 §8 (S01); arte e pivôs do S02. Este texto assume S
(SVG+CSS+TS); se R venceu, a API pública é a mesma e a implementação usa o runtime lazy (carregado após o LCP), com
pose SVG estática como fallback e enquanto carrega.

## Escopo (faz)

- Tokens (`packages/design-tokens/src/tokens.css`), por `[data-theme]` e `[data-brand='leadium'|'odonto'|'maian']`
  (`leadium` = padrão em `:root`): `--cp-ink`, `--cp-ink-a`, `--cp-ink-b`, `--m-ink`, `--m-fill`, `--m-accent`,
  `--m-visor`, `--m-eye`, `--m-cut`, `--m-dur-blink: 140ms`, `--m-dur-wave: 860ms`, `--m-dur-celebrate: 900ms`.
  Valores do S02. Teste em `packages/design-tokens/src/tokens.test.ts`: cada parada `--cp-ink*` ≥ 4,5:1 sobre
  `--surface` e `--surface-2` nas 3 marcas × 2 temas e luminância monotônica; `--m-ink` ≥ 3:1. Maian: letra
  `#B4530F`, mascote `#D4610F`; nunca `#EE7623` como texto.
- `packages/ui/src/Mascot/`:
  - `Mascot.tsx` com as props da spec §6.1; escolhe LOD por `size`; SVG inline da arte do S02 (gerado em
    `generated/*.tsx` por script `scripts/build-art.mjs` dentro da pasta, a partir dos `.svg`); `aria-hidden`;
    caixa de tamanho fixo;
  - `machine.ts`: máquina de estados pura (spec §3.2: transições, fila de 1, `thinking` interrompe, todo estado
    finito volta a `idle`), testada sem DOM;
  - `motion.css`: keyframes por estado e LOD usando os pivôs do `rig.json`, só `transform`/`opacity`;
    `@media (prefers-reduced-motion: reduce)` e `[data-motion='off']` congelam pose com esmaecimento de 160 ms;
    `[data-motion='subtle']` conforme spec §6.1;
  - piscar com intervalo aleatório 4–9 s, só com aba visível e elemento na viewport (`IntersectionObserver`), sem
    `setInterval` rodando escondido;
  - `MascotStage.tsx` (provider + `useMascotStage`): `brandVariant`, `motion`, `claim/release` ("um ator por vez");
- `packages/ui/src/GradientText/`: spec §6.3; `@property --cp-sweep` registrado uma vez; detecção de suporte;
  sem suporte ⇒ texto sólido, `onSweepEnd` chamado imediatamente; reentrância ignorada.
- `packages/ui/src/LongWait/`: `LongWait.tsx`, `Thinking.tsx`, `useLongWait.ts` com os tempos da spec §6.4
  (1.200 ms de entrada, ≥ 600 ms visível, 8 s texto honesto e Cancelar, 300 ms do `Thinking`), anúncio único em
  `aria-live="polite"`; marca `glyph` ⇒ skeleton + texto.
- Exportar tudo por `packages/ui/src/index.ts`; histórias Ladle de cada estado, tema e marca.
- Testes (vitest happy-dom): máquina; reduced-motion congela; aba oculta pausa; `claim` concedido a um só;
  `LongWait` não mostra personagem em espera de 1.100 ms e mostra em 1.300 ms e fica até 1.900 ms se resolver em
  1.300 ms (relógio falso); `GradientText` sem `@property` fica sólido; a11y (`a11y.test.tsx`: `aria-hidden`,
  live region).
- Orçamento: medir o gz de tudo que a F76 adiciona ao `@hm/ui` (arte + CSS + TS) com o script do S01 adaptado e
  registrar; teto 30 KB, meta 12 KB.

## Fora de escopo

- Diretor de atenção (S04), launcher (S05), uso em telas (S06, S07), plumbing de `data-brand` (S08).

### files_allowed

- `packages/design-tokens/src/tokens.css`
- `packages/design-tokens/src/tokens.test.ts`
- `packages/ui/src/Mascot/Mascot.tsx`
- `packages/ui/src/Mascot/MascotStage.tsx`
- `packages/ui/src/Mascot/machine.ts`
- `packages/ui/src/Mascot/motion.css`
- `packages/ui/src/Mascot/generated/**`
- `packages/ui/src/Mascot/scripts/**`
- `packages/ui/src/Mascot/index.ts`
- `packages/ui/src/Mascot/*.test.tsx`
- `packages/ui/src/Mascot/*.test.ts`
- `packages/ui/src/Mascot/*.stories.tsx`
- `packages/ui/src/GradientText/**`
- `packages/ui/src/LongWait/**`
- `packages/ui/src/index.ts`
- `packages/ui/src/a11y.test.tsx`

### files_forbidden

- `packages/ui/src/Mascot/art/**` (S02; mudança de arte volta para lá)

## Definition of Done

- [ ] contratos da spec §6.1–§6.4 implementados com os nomes e tipos exatos (a F74 depende deles)
- [ ] testes de contraste dos tokens nas 3 marcas × 2 temas verdes
- [ ] reduced-motion e `motion='off'` congelam; aba oculta e fora da viewport param de animar (teste)
- [ ] nada pisca acima de 3 Hz (o teste lê as durações das keyframes de loop)
- [ ] peso gz registrado nas notas, ≤ 30 KB (meta 12 KB)
- [ ] histórias Ladle de todos os estados; capturas 24/48/128 × dark/light × 3 marcas
- [ ] revisão `review-animations` + `/hm-designer` aprovadas (veredito nas notas)

## Validação

```bash
pnpm --filter @hm/design-tokens exec vitest run --maxWorkers=1
pnpm --filter @hm/ui typecheck
pnpm --filter @hm/ui exec vitest run --maxWorkers=1
pnpm --filter @hm/web typecheck
```

## Notas

- Agente: `frontend-engineer`. `tokens.css` é arquivo disputado (a F73/F74 pode criar tokens do Copiloto):
  sequenciar pelo `plan-batch` e acrescentar em bloco próprio comentado `/* F76 — personagem */`.
