---
id: F0-S09
title: Design tokens — CSS vars + Tailwind preset + tipografia + fontes
phase: F0
status: review
priority: critical
estimated_size: M
depends_on: [F0-S01]
agent_id: backend-engineer
claimed_at: 2026-06-09T03:11:56Z
completed_at: 2026-06-09T03:15:49Z

---
# F0-S09 — Design tokens (CSS vars + Tailwind preset + tipografia)

> Refina o ROADMAP F0-S09 (parte "tokens"). É a base de tudo que é visual — nenhum primitive ou tela existe sem isto.
> **source_docs:** `docs/DESIGN_SYSTEM.md` §2, §3, §7, §15, §14
> **blocks:** F0-S10, F0-S11, F0-S12, F0-S13

## Objetivo

Materializar `@hm/design-tokens` como fonte única dos tokens do DS v2: CSS variables (primitivos theme-agnostic + semânticos dark/light), preset Tailwind 4, escala tipográfica e configuração de fontes.

## Contexto

Hoje `packages/design-tokens` é um skeleton (só marca + 3 consts). Este slot o torna real. Desbloqueia `@hm/ui` (F0-S10) e o shell web (F0-S11), que consomem `--bg`, `--surface`, `--text`, `--brand` e o preset Tailwind.

## Escopo (faz)

- `packages/design-tokens/src/tokens.css` — `:root` com primitivos (cores de marca `--brand`=#1FFF13 e variações, estados danger/warn/info/success, fontes, `--r-*`, `--sp-*`) e blocos semânticos `[data-theme="dark"]` (default) + `[data-theme="light"]` (`--bg`, `--surface*`, `--text*`, `--border*`, `--elev-*`, `--glow-*`) exatamente como `DESIGN_SYSTEM.md` §2.1/§2.2. Ajustar elev/glow do light.
- `packages/design-tokens/src/tailwind-preset.ts` — preset `Partial<Config>` mapeando colors/fontFamily/borderRadius/boxShadow para as CSS vars (§2.3).
- `packages/design-tokens/src/typography.ts` — escala H1–H4/body/small/price/display (família, size, weight, tracking) como objeto tipado (§3).
- `packages/design-tokens/src/fonts.ts` — definição das famílias (Rajdhani, Manrope, Chakra Petch, Orbitron) + helper de `<link>`/`next/font` (§15). Expandir o atual `fonts` const.
- `packages/design-tokens/src/index.ts` — barrel reexportando tudo + `tokens.css` documentado para import.
- `packages/design-tokens/package.json` — adicionar `tailwindcss` como peer/dev para tipar o preset.

## Fora de escopo

- Componentes React (são F0-S10).
- `globals.css` do app e wiring do `next/font` no layout (são F0-S11).
- Self-host de fontes via Fontsource (§15: fase 2).

## Arquivos permitidos

- `packages/design-tokens/**`

## Arquivos proibidos

- `packages/ui/**`, `apps/web/**` (outros slots).

## Contratos de saída

- Tokens CSS importáveis: `import '@hm/design-tokens/tokens.css'`.
- `import preset from '@hm/design-tokens/tailwind-preset'` → usado em `apps/web/tailwind.config.ts` e nas stories do `@hm/ui`.
- `typography`, `fonts`, `BRAND_NEON`, `radii`, `ThemeName` exportados do barrel.

## Definition of Done

- [ ] `tokens.css` com primitivos + dark + light completos; troca de tema só por `data-theme` (nunca classe `.dark`).
- [ ] `tailwind-preset.ts` tipa sem erro e cobre colors/fonts/radius/shadow/glow.
- [ ] Contraste: `--text` sobre `--bg` ≥ 7:1 (AAA) em dark e light; `--text-mid` ≥ 4.5:1 (DESIGN_SYSTEM §8.3).
- [ ] Zero hex hardcoded fora de `tokens.css` (o resto referencia var()).
- [ ] `pnpm typecheck` e `pnpm lint` limpos.

## UX considerations

- Aplica DESIGN_SYSTEM §1.1 (dark-first: `:root` = dark) e §1.4 (tokens semânticos, nunca hex em JSX).
- Aplica §8.1 (token `--glow-md` existe para o focus ring obrigatório que os primitives vão consumir).
- Habilita UX_PRINCIPLES §3.5 (hover/cursor) e §2.7 (skeleton/loading) ao prover os tokens de superfície/estado.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Notas

- `--brand` é precioso: 1 por tela (§1.2). Os tokens soft/faint existem p/ status/chips.
- Manter os nomes de var idênticos ao doc — os primitives (F0-S10) dependem deles.
