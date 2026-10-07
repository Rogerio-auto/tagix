---
id: F72-S01
title: Tokens, fontes e escala tipográfica do DS 3.0, com tema claro corrigido
phase: F72
status: review
priority: critical
estimated_size: M
ui: true
depends_on: []
blocks: [F72-S02, F72-S03]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/decisions/ADR-002-tipografia-ds3.md
  - docs/DESIGN_SYSTEM_V3_DELTA.md
  - docs/design/ds-3.0-agency-os.html
agent_id: backend-engineer
claimed_at: 2026-10-07T18:30:43Z
completed_at: 2026-10-07T19:09:17Z

---
# F72-S01 — Tokens, fontes e escala tipográfica do DS 3.0

## Objetivo

`@hm/design-tokens` passa a carregar os valores do DS 3.0 (paleta, raios, sombras, glow, tipografia), com os dois temas completos e o claro corrigido para AA, **sem renomear nenhum token existente**. O app carrega Space Grotesk, Manrope e IBM Plex Mono via `next/font`, e o Orbitron sai.

## Escopo (faz)

- `tokens.css`:
  - valores do DS 3.0 nos nomes semânticos do v2 (mapa em `DS3_ADOCAO.md` §3; conferir os nomes reais no arquivo);
  - tokens novos: `--bg-elevated`, `--surface-glass`, `--violet`, `--brand-text`, `--shadow-1..3`, `--glow`, `--r-xl`, `--font-mono`;
  - `--font-price` vira alias de `--font-mono` e `--font-display` vira alias de `--font-head`;
  - tema claro completo, com `--text-low ≈ #5F6A5E`, `--brand-text` e tons de status do claro, todos ≥4,5:1. Os pares (texto × fundo, nos dois temas) ficam medidos numa tabela nas Notas de execução.
- `typography.ts` + `@theme` (em sincronia):
  - heads em Space Grotesk com o tracking do ADR;
  - `body` 16px/500/1.65;
  - `price` em mono com `tabular-nums`;
  - `display` passa a usar a família de head, sem caixa-alta forçada (a menos que a maquete use).
- `fonts.ts` e `apps/web/app/layout.tsx`: `next/font` com Space Grotesk (500, 600, 700), Manrope (400 a 700) e IBM Plex Mono (400, 500, 600), `display: swap`, só o subset latin. Sai o Orbitron, a Rajdhani e a Chakra Petch.
- `tailwind-preset.ts` expõe os tokens novos (cores, sombras, `rounded-xl`, `font-mono`).
- Docs:
  - `DESIGN_SYSTEM.md`: seção v3 com os tokens, a tipografia e o §14 apontando para o ADR-002;
  - `APP_MOBILE_PLAN.md` §3.1 com 4 abas + Mais;
  - `INDEX.md` com o link para a F72.
- Teste de contraste automatizado: lê os pares do `tokens.css` dos dois temas e falha abaixo de 4,5:1 (texto) ou 3:1 (UI).

## Fora de escopo

- Componentes (S02), shell (S03) e telas (S04–S08).

### files_allowed

- `packages/design-tokens/**`
- `apps/web/app/layout.tsx`, `apps/web/app/globals.css`
- `docs/DESIGN_SYSTEM.md`, `docs/features/APP_MOBILE_PLAN.md`, `docs/INDEX.md`, `docs/features/DS3_ADOCAO.md`

## Definition of Done

- [ ] nenhum token existente renomeado ou removido (diff dos nomes no slot)
- [ ] teste de contraste dos dois temas verde
- [ ] build do web verde; First Load JS não cresce por fonte. Medir os bytes de fonte antes e depois: 3 famílias contra 4
- [ ] capturas de 3 telas (Home, inbox, login) antes/depois em 1440 dark e light, só para mostrar a repintura
- [ ] docs atualizados

## Validação

```bash
pnpm --filter @hm/design-tokens typecheck
pnpm --filter @hm/design-tokens test
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web build
```

## Notas

- Agente: `frontend-engineer`.
- Não colar o `:root` da maquete (`DESIGN_SYSTEM_V3_DELTA` §3.1).

## Notas de execução (frontend-engineer, 2026-10-07)

### Peso de fonte (build de produção, `.next/static/media`, woff2)

| | Antes (4 famílias) | Depois (3 famílias) |
|---|---|---|
| Famílias | Rajdhani, Manrope, Chakra Petch, Orbitron | Space Grotesk, Manrope, IBM Plex Mono |
| Arquivos woff2 no build | 28 | 24 |
| Bytes no build (todos os subsets) | 342.068 | **221.400** (−35,3%) |
| Bytes pré-carregados (subset latin, o que o 1º paint baixa) | 93.864 (8 arquivos) | **77.128** (5 arquivos; −17,8%) |
| Por família (todos os subsets) | Rajdhani 164.980 · Manrope 74.804 · Chakra Petch 90.516 · Orbitron 11.768 | Space Grotesk 48.016 · Manrope 74.804 · IBM Plex Mono 98.580 |
| First Load JS compartilhado | n/m (build anterior não registrou) | 213 kB (fonte não entra no JS) |

### Contraste medido (WCAG 2.1; teste `tokens.test.ts`, 240 casos verdes)

Menor razão por token, entre as 6 superfícies (`bg`, `bg-alt`, `surface`, `surface-2`, `surface-3`, `surface-inset`). Piso: texto 4,5:1.

| Par | Escuro (mín.) | Claro (mín.) |
|---|---|---|
| `--text` | 15,41 (surface-3) | 15,95 (bg-alt) |
| `--text-mid` | 10,01 (surface-3) | 7,44 (bg-alt) |
| `--text-low` | **4,57** (surface-3), `#7E897E` | **5,00** (bg-alt), `#5F6A5E` (DS 3.0 trazia `#788277` = 3,99) |
| `--brand-text` | 12,86 (surface-3) | 5,71 (bg-alt) |
| `--violet` | 6,13 (surface-3) | 4,97 (bg-alt) |
| `--danger` / `--warn` / `--info` / `--success` sobre superfícies | 5,68 / 10,58 / 7,76 / 10,74 | 5,84 / 5,63 / 5,69 / 5,57 |
| idem sobre o próprio `-bg` | 6,14 / 10,44 / 8,20 / 11,10 | 5,75 / 5,72 / 5,59 / 5,53 |
| `--text-on-brand` sobre `--brand` / `--brand-strong` | 14,07 / 10,71 | 14,07 / 10,71 |
| `--brand-soft` / `--brand-bright` / `--brand` como texto (só escuro) | 14,07 / 12,86 / 12,18 | n/a (a marca no claro nunca é texto) |
| UI ≥3:1: `--brand` (escuro) · `--brand-text` (claro) sobre bg/surface/surface-3 | 12,18 a 14,62 | 5,75 a 6,47 |

Referência: `--brand #16E00A` sobre branco no claro = 1,79:1, por isso nunca é texto.

### Tokens

- **Nomes inalterados:** os 90 nomes do `tokens.css` anterior continuam declarados (lista congelada no teste, `V2_TOKEN_NAMES`). Nenhum renomeado/removido.
- **Nomes novos:** `--bg-elevated`, `--surface-glass`, `--violet`, `--brand-text`, `--shadow-1..3`, `--glow`, `--r-xl`, `--font-mono`. Utilitários Tailwind: `bg-bg-elevated`, `bg-surface-glass`, `text-violet`, `text-brand-text`, `shadow-ds-1..3`, `shadow-glow`, `rounded-xl`, `font-mono`.
- **Só valor mudou:** paleta de superfície/texto/borda dos dois temas, `--brand-bright`, `--brand-soft`, `--text-on-brand` (`#071108`), `--danger/--warn/--info` (e variantes do claro), `--r-xs 7`, `--r-lg 18`, `--font-head/--font-body`, `--font-price` e `--font-display` (agora aliases), escala tipográfica (body 16/500/1,65; price mono 500; heads −4,5%/−3,5%; display sem caixa-alta).
- **Desvios/efeitos a saber:** (1) `--border-2` ficou mais forte que `--border` (no v2 era mais sutil); (2) `rounded-xl` passa de 12px (Tailwind) para 24px (`--r-xl`), 24 usos no app; (3) `--text-low` escuro cai do `#a3aca4` (AAA, F10-S05) para `#7E897E` (AA); (4) tema claro agora redefine `-bg` de estado (antes herdava os fundos escuros).
- **Bug anterior à F72 achado e contornado:** `@hm/ui/styles/theme.css` declara `--font-head: var(--font-head)` (e body/display/price) no `@theme`; a auto-referência é cíclica e, ordenada depois de `tokens.css`, invalida a variável. Resultado medido no build antigo: `--font-head` computado vazio e `body` em `ui-sans-serif`, ou seja, **Rajdhani/Manrope/Chakra/Orbitron nunca renderizaram no app**. Contornado em `apps/web/app/globals.css` (bloco `:root` com bloco comentado para remover quando o S02 apagar as 4 linhas do theme.css).

### Capturas

Só `/login` (público) em 1440 dark e light, antes e depois (Home e inbox exigem sessão e API/Supabase, indisponíveis neste ambiente de slot). Arquivos: `scratchpad/f72-s01-shots/login-{dark,light}-{before,after}.png` (não versionados, fora do `files_allowed`). O antes mostra a fonte do sistema (o bug acima), o depois mostra Space Grotesk/Manrope reais.

### Validação

`@hm/design-tokens` typecheck OK; test 240/240; `@hm/web` typecheck OK; `@hm/web` build OK; `@hm/ui ladle:build` OK. ESLint: 0 erros (2 warnings de hex no `themeColor` do `layout.tsx`, preexistentes e inevitáveis em `Viewport`).

### Fora do `files_allowed` (anotado)

`pnpm-lock.yaml` (vitest/@types/node como devDependency do `@hm/design-tokens`, via `corepack pnpm@11.5.2`, diff de 8 linhas) e este `.md`.

