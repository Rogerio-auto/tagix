# Teclado + ARIA — checklist (F10-S05)

> Cobre os primitives `@hm/ui` e a camada `apps/web/shared`. Telas flagship
> (dashboard, pipeline, conversations, flow-builder) foram **auditadas em
> leitura** — elas vivem em `apps/web/features/**`, fora da fronteira deste slot;
> os achados ficam como follow-up no fim.

## Princípios aplicados

- **UX §2.10** (atalho-fantasma): teclado em tudo que é clicável; `Esc` fecha overlays; `Cmd/Ctrl+K` abre paleta.
- **UX §3.5** (cursor/hover/focus ensinam): `focus-visible` nunca suprimido — anel `shadow-glow-md`.
- **UX §2.7** (click-fantasma): `aria-live` anuncia feedback de ação assíncrona.
- **WCAG 2.4.1** (bypass blocks): skip-to-content. **WCAG 2.4.3** (focus order): foco volta ao gatilho ao fechar overlay.

---

## Correções por componente

### `@hm/ui`

| Componente | Antes | Depois |
|---|---|---|
| **Button** | `aria-busy` + disabled em loading (ok) | inalterado; coberto por teste de contrato |
| **Input** | `aria-invalid` + `aria-describedby` (ok) | **mensagem de erro vira `role="alert"` + `aria-live="assertive"`** — SR anuncia a validação na hora (§2.7) |
| **Modal** | `role=dialog`, `aria-modal`, focus trap, Esc (ok) | **focus-restore ao gatilho ao fechar** (2.4.3) + `aria-label="Diálogo"` fallback quando sem título |
| **Toast** | `role=status`/`alert` por variante (ok) | **`aria-live` explícito** (assertive p/ erro, polite p/ resto) + **`aria-atomic="true"`** (lê título+descrição como unidade) |
| **HelpHint/HelpPanel** | `aria-haspopup`, trap, Esc (ok) | **focus-restore ao `?` ao fechar** o painel (2.4.3) |
| **Card/EmptyState/ErrorState/Skeleton** | já corretos (Skeleton `aria-hidden`; SkeletonList `aria-busy`; ErrorState `role=alert`; ícones `aria-hidden`) | sem mudança necessária |

### `apps/web/shared`

| Componente | Correção |
|---|---|
| **AppLayout** | montou `<SkipLink>` como 1º focável; `<main id="main-content" tabIndex={-1}>` vira alvo do skip |
| **SkipLink** (novo) | link "Pular para o conteúdo" `sr-only` até foco; `focus-visible:not-sr-only` (WCAG 2.4.1) |
| **Sidebar** | `<aside aria-label="Navegação principal">` — distingue o landmark; itens já tinham `aria-current` + `focus-visible` |
| **CommandPalette** | padrão **combobox/listbox** (APG): input `role=combobox` + `aria-activedescendant`; `<ul role=listbox>`, itens `role=option`/`aria-selected`; botões internos `tabIndex={-1}` (navegação por setas, não Tab); **focus-restore ao fechar** |
| **Sheet** | adicionado **focus trap (Tab/Shift+Tab) + focus-restore** + foco inicial dentro do painel ao abrir |
| **TopBar** | botões já tinham `aria-label` dinâmico + `focus-visible` — sem mudança |

---

## Checklist DoD

- [x] Contraste **AAA** dos tokens de texto principal/secundário validado (ver `contrast-audit.md`).
- [x] `:focus-visible` visível em todos os interativos tocados (anel `shadow-glow-md`).
- [x] `Esc` fecha Modal, HelpPanel, CommandPalette, Sheet.
- [x] `Tab`/`Shift+Tab` preso dentro de Modal, HelpPanel e Sheet (focus trap).
- [x] Foco devolvido ao elemento de origem ao fechar overlay (Modal, HelpPanel, CommandPalette, Sheet).
- [x] `aria-live` em feedback de ação (Input error, Toast).
- [x] Skip-to-content + landmarks rotulados.
- [x] `prefers-reduced-motion` respeitado (animações via `motion-safe:` — herdado do DS, sem regressão).
- [ ] **axe-core scan automatizado** — pendente de deps (ver `README.md`); cálculo manual feito.

---

## Follow-ups (fora da fronteira F10-S05)

Auditoria de leitura das telas flagship — itens para slots de feature (`apps/web/features/**`):

1. **ChatList (`conversations`)**: confirmar `↑`/`↓` navega itens e `Enter` abre (UX §2.10 cita setas em listas). Hoje os itens são focáveis, mas a navegação por seta na lista não está garantida — recomendar `roving tabindex` ou `aria-activedescendant`.
2. **Pipeline (dnd-kit)**: drag de card por mouse existe; garantir alternativa por teclado (dnd-kit `KeyboardSensor`) e anúncio `aria-live` de "movido para etapa X" (acessibilidade do drag-and-drop).
3. **Flow-builder (ReactFlow)**: canvas é intrinsecamente visual; documentar que criação/edição de node tem caminho por teclado via inspector lateral (já é o padrão §2.1), e marcar o canvas com instrução para SR.
4. **Backdrops `div onClick`** (ContactDetailDrawer, CustomizeDashboardDrawer): já `aria-hidden` + Esc fecha — ok, sem ação.

Esses não bloqueiam F10-S05 (boundary = `shared`/`ui`/`tokens`); registrados para o backlog de a11y das features.
