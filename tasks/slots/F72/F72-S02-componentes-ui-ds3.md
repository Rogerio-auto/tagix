---
id: F72-S02
title: Componentes do @hm/ui no DS 3.0 — botões, campos, status, tabela operacional e camadas
phase: F72
status: review
priority: critical
estimated_size: M
ui: true
depends_on: [F72-S01]
blocks: [F72-S04, F72-S05, F72-S06, F72-S07, F72-S08]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/design/ds-3.0-agency-os.html
agent_id: backend-engineer
claimed_at: 2026-10-07T20:07:51Z
completed_at: 2026-10-07T20:09:42Z

---
# F72-S02 — Componentes do @hm/ui no DS 3.0

## Objetivo

Os componentes compartilhados seguem a seção "Components" da maquete: estados claros, feedback imediato, borda antes de sombra e raios deliberados. As telas que os usam herdam o visual novo sem mudança local.

## Escopo (faz)

- Button (primary, secondary, ghost, danger; loading, disabled e foco), IconButton, Input (campo e estados: foco, erro, sucesso, desabilitado, com ajuda), Card, Modal, Drawer, Toast, Avatar, Skeleton, EmptyState, ErrorState e HelpHint.
- **Novos**, se não existirem:
  - `Badge` / `StatusPill` (status, badges);
  - `Switch`;
  - `DataTable` operacional (cabeçalho fixo, número em mono à direita, densidade, linha com estado, vazio e carregando), no padrão "Operational table".
- Movimento pela linguagem do §05:
  - Lift no hover, State morph no toggle e Signal pulse só em estado vivo;
  - entrada com fade de 4 a 10px;
  - curvas e durações pelos tokens `--ease` / `--dur-*`;
  - `motion-reduce` em tudo.
- Stories (se o pacote usa Storybook) ou página de catálogo, e o `a11y.test.tsx` cobrindo os componentes novos.

### files_allowed

- `packages/ui/**`

## Definition of Done

- [ ] todos os componentes listados no visual do DS 3.0, nos dois temas
- [ ] componentes novos exportados e testados (estados e teclado)
- [ ] `a11y.test.tsx` verde; axe sem violação séria
- [ ] nenhum hex literal (lint)
- [ ] revisão `/hm-designer` contra a seção Components da maquete

## Validação

```bash
pnpm --filter @hm/ui typecheck
pnpm --filter @hm/ui test
pnpm --filter @hm/web typecheck
```

## Notas

- Agente: `frontend-engineer`. Paralelo à S03 (paths disjuntos).

## Notas de execução (frontend-engineer, 2026-10-07)

### Entregue

- Reestilizados no DS 3.0: Button (primary com brilho de varredura e Lift; secondary, outline, ghost, danger suave, link), IconButton, Input (+ estado `success`, 16px abaixo de `sm`), Card (+ `interactive`), Modal, Drawer, Toast (vidro + chip), Avatar (+ `shape`), Skeleton (shimmer), EmptyState, ErrorState, HelpHint/HelpPanel.
- Novos e exportados: `Badge`, `StatusPill` (`live` = Signal pulse), `Switch` (State morph), `DataTable` (cabeçalho fixo, mono à direita, densidade, estado de linha, ordenação, vazio/erro/carregando, teclado).
- `theme.css`: apagadas as 4 linhas cíclicas `--font-*: var(--font-*)`. O Tailwind emite a declaração em `:root` mesmo com `@theme inline`, então as famílias viraram `@utility font-head|body|display|price`. O `@theme` de cores/sombras/raios virou `inline`, com os tokens novos do DS 3.0 repetidos. Motivo: sem `inline`, um subtree com `data-theme` próprio herda o tema da raiz. Novos utilitários `ease-ds` e `ease-ds-spring`; keyframes `hm-rise`, `hm-signal`, `hm-shimmer`.
- `.ladle/components.tsx` passa `data-theme` também para `<html>` (portais de Modal/Drawer/Toast ignoravam o tema claro). `.ladle/head.html` carrega as 3 famílias (Google Fonts, só catálogo). `src/lib/ThemePair.tsx` renderiza os dois temas lado a lado.

### Validação (números reais)

| Comando | Resultado |
|---|---|
| `pnpm --filter @hm/ui typecheck` | OK, 0 erros |
| `pnpm --filter @hm/ui test` | 12 arquivos, 74/74 (eram 43; novos: Badge 5, Switch 8, DataTable 10, a11y +8) |
| `eslint packages/ui` | 0 erros, 0 warnings; 0 hex literal em `packages/ui/src` |
| `pnpm --filter @hm/ui ladle:build` | OK, 66 stories |
| `pnpm --filter @hm/web typecheck` | OK |
| axe-core 4.12 (Chromium/Playwright, build do Ladle, 66 stories x 2 temas, incl. color-contrast) | 0 violações sérias/críticas; só `region` (moderada, é o harness do Ladle sem landmark) |

Falhas achadas e corrigidas no caminho: (1) `violet` no Badge claro dava 4,49:1 sobre a tinta de 10% (corrigido com tinta de 6%); (2) `role="region"` do DataTable repetido gerava `landmark-unique` (virou `role="group"`); (3) Switch descartava `aria-label` (faltava `{...props}`).

Achado de tokens (S01, pendência): `[data-theme='dark']` não redeclara `--danger/--warn/--info/--success`; um subtree escuro aninhado dentro de `html[data-theme=light]` herda os tons do claro (reprova contraste só nessa combinação artificial). Não afeta o app (tema só na raiz); afeta o `ThemePair` quando o toggle do Ladle está em claro.

### Barra de pronto aplicável

- Dois temas: stories `BothThemes` em todos os componentes; overlays (Modal/Drawer/Toast) via toggle do Ladle, com story `OpenByDefault`/`AllVariantsVisible`. Capturas 1280px dark e light (22 stories) em `scratchpad/shots` do worker (não versionadas).
- Não feito: capturas 375/768 (catálogo, sem layout responsivo próprio) e revisão `/hm-designer` formal (a cargo do orchestrator).
- UX aplicada: §2.1 (linha clicável no DataTable, Card `interactive`), §2.3 (Drawer p/ detalhe), §2.6 (vazio/erro dentro da tabela), §2.7 (loading em Button/Switch/DataTable, skeleton), §2.9 (danger suave, peso na confirmação), §2.10 (Enter/Espaço/setas na tabela, Switch por teclado), §2.11 (ErrorState em 3 partes).
- Movimento: Lift (Button, Card interactive), Signal pulse só em `Badge live`, State morph no Switch, entrada fade + 8px, tudo sob `motion-safe`/`motion-reduce`.

### Revisao de design

Veredito inicial: **REPROVADO** por foco (anel `shadow-glow-md` verde-neon com contraste < 3:1, WCAG 1.4.11; Input com erro sem foco visivel por `focus:shadow-none`). Corrigido.

- Novo `@utility focus-ring` em `theme.css` (outline 2px solid `--focus-ring-color` com fallback `--brand-text`, offset 2px). Aplicado como `focus-visible:focus-ring` em Button, IconButton, Switch, Card (removido `focus-visible:border-brand`), DataTable (2), Input, ErrorState, HelpHint (3), AnchoredHelpHint. CSS gerado conferido: a regra `focus-ring:focus-visible` e emitida depois de `.outline-none` e tem maior especificidade, entao vence o reset. Input: `focus:border-brand-text` (glow-sm so decoracao); com erro, `--focus-ring-color: var(--danger)` (anel danger visivel).
- Ressalvas: loading nao parece disabled (`disabled:not-aria-busy:opacity-40 aria-busy:cursor-progress` em Button/IconButton/Switch); `active:scale` sob `motion-safe:`; brilho do primary via `color-mix(var(--text-on-brand) 14%)` (sem rgb literal); Toast com fundo opaco `bg-surface-2` e vidro/blur so com `supports-[backdrop-filter]` e fora de `prefers-reduced-transparency`; DataTable `tabIndex` so com `maxHeight`; Modal ganhou `initialFocusRef?` (opcional, API compativel); Button/Badge em `font-body font-bold` (Manrope 700, como a maquete `.btn`/`.badge`), labels de Input/Switch em `font-body font-bold`.
- Desvios fora de `packages/ui` (autorizados): (a) `packages/design-tokens/src/tokens.css`: bloco `[data-theme='dark']` redeclara `--danger/--warn/--info/--success` (+ `-bg`); fecha a pendencia de tokens acima. (b) `apps/web/app/globals.css`: removido o bloco `:root` de fontes redundante; CSS do build mostra `--font-head: var(--font-head-next,"Space Grotesk"),"Manrope",...` (sem auto-referencia).
- Testes ajustados: Switch/IconButton/a11y checam `focus-visible:focus-ring`; testes do DataTable passam `maxHeight` ao exigir `tabindex=0`.
- Numeros: `@hm/ui` typecheck OK, vitest 74/74 (12 arquivos), eslint packages/ui 0 erros, `ladle:build` OK, `@hm/design-tokens` 240/240, `@hm/web build` OK, axe 66 stories x 2 temas: so `region` (90 ocorrencias, harness do Ladle), 0 sérias/críticas.
