---
id: F59-S08
title: DS 3.0 opção A — rampa de marca, motion e regras em lint
phase: F59
status: in-progress
priority: medium
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/DESIGN_SYSTEM_V3_DELTA.md
  - docs/DESIGN_SYSTEM.md
agent_id: backend-engineer
claimed_at: 2026-09-09T13:23:12Z

---
# F59-S08 — DS 3.0 opção A — rampa de marca, motion e regras em lint

## Objetivo

Adotar o que a proposta DS 3.0 tem de melhor **sem tocar em um pixel existente**: rampa de marca,
tokens de easing e três regras de lint que o DS v2 não tem.

## Contexto

`DESIGN_SYSTEM_V3_DELTA` §8 opção A — aprovada. As opções B (repaleta) e C (reversão tipográfica)
seguem pendentes de decisão do fundador e **não** entram aqui. Hoje existe um verde só, o que força
hover, foco, glow e desabilitado a serem inventados caso a caso.

## Escopo

### files_allowed

- `packages/design-tokens/src/tokens.css`
- `packages/design-tokens/src/tailwind-preset.ts`
- `packages/design-tokens/src/index.ts`
- `packages/design-tokens/src/*.test.ts`
- `eslint.config.mjs`
- `docs/DESIGN_SYSTEM.md`

### files_forbidden

- `packages/design-tokens/src/fonts.ts`
- `packages/design-tokens/src/typography.ts`
- `apps/web/**`

## Escopo (faz)

- **Rampa de marca**, aditiva, sem alterar `--brand`: `--brand-strong: #16E00A`,
  `--brand-bright: #72FF69`, `--brand-soft: #B1FFAA`. Mapear `--brand-ink` como alias do
  `--text-on-brand` já existente (alias, não rename — renomear quebra consumidores).
- **Tokens de motion**: `--ease: cubic-bezier(.2,.8,.2,1)` e
  `--ease-spring: cubic-bezier(.16,1,.3,1)`, expostos também no preset Tailwind.
- **Três regras em `eslint.config.mjs`** (`no-restricted-syntax`, em `apps/web/**` e `packages/ui/**`):
  1. hex literal em JSX/TSX → usar token semântico;
  2. `Intl.NumberFormat`/`toLocaleString`/`Intl.DateTimeFormat` com locale **literal** → o locale vem do market pack;
  3. fuso literal em string (`'America/…'`) fora de `packages/shared/src/markets.ts`.
- Documentar a rampa e as regras em `DESIGN_SYSTEM.md`, marcando a origem (DS 3.0 §07).

## Fora de escopo

- Trocar `--bg`/`--surface`/`--surface-2`/`--surface-3` (opção B — repinta as 34 telas).
- Trocar tipografia (opção C).
- Corrigir os dois valores de contraste do tema claro do DS 3.0 — pertencem a B/C, e o tema claro
  atual do v2 é outro conjunto de valores.

## Definition of Done

- [ ] Nenhum token existente muda de valor. `git diff` em `tokens.css` é só adição — verificável.
- [ ] Rampa definida nos dois temas (dark e light), com o claro escolhido para contraste, não por espelho do escuro.
- [ ] As três regras de lint pegam os casos reais e não quebram o build atual: rodar `pnpm lint` e corrigir o que aparecer **dentro** do `files_allowed`; ocorrência fora da fronteira vira linha em `tasks/COMMS.md`, não edição.
- [ ] Se a regra 2 ou 3 acusar mais de 10 ocorrências fora da fronteira, entra como `warn` com TODO datado e um slot de limpeza é registrado — não `error` que trava o CI de todo mundo.
- [ ] `pnpm lint` e `pnpm typecheck` verdes no repo inteiro.
- [ ] `DESIGN_SYSTEM.md` documenta a rampa, os easings e as três regras.

## Validação

```bash
pnpm --filter @hm/design-tokens typecheck
pnpm --filter @hm/design-tokens test
pnpm lint
pnpm typecheck
```

## Notas

- O script da própria página DS 3.0 faz `toLocaleString('en-US')` fixo — viola a regra que ela mesma
  escreve. É a melhor evidência de que a regra precisa existir em lint, não em documento.
- `--brand-ink` como **alias** e não rename: `--text-on-brand` já é consumido; quebrar por estética
  de nome é exatamente o tipo de dívida que este repo existe para não ter.
