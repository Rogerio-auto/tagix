# MOBILE_UX — Padrões mobile do Highermind v2

> **Documento:** padrões de UX mobile inegociáveis. Complementa `UX_PRINCIPLES.md`
> (§8/§9 promovem mobile a cidadão de primeira classe). Todo slot da fase F36
> (Mobile Responsive & PWA) consome esta referência.
> **Origem:** `docs/features/MOBILE_RESPONSIVE_PLAN.md` §4/§5.
> **Corte mobile (D4):** abaixo de `md` (768px) usa os padrões mobile; `md+`
> mantém o layout desktop. Use `useBreakpoint()` (`isMobile`) — nunca duplique o número.
> **Versão:** 1.0 — 2026-06-16

---

## 0. Filosofia

Mobile **não é** o app desktop encolhido. É o **mesmo produto**, redesenhado para
o toque e para a mão única. Mesma identidade DS v2 (dark-first, tipografia
editorial, verde-neon `--brand` no máximo 1×/tela), mesmos tokens, outra ergonomia.
Se uma tela mobile parece um template responsivo genérico, reprovou.

---

## 1. Princípios (inegociáveis no mobile)

1. **Thumb-first.** Ação primária na zona do polegar (rodapé), nunca só no topo.
   Nav primária = **bottom tab bar**; CTA de tela = botão/área inferior fixa
   (com `pb-safe`). O topo é para contexto e "voltar", não para ações frequentes.
2. **Uma intenção por view.** Em telas estreitas nada de 3 painéis simultâneos.
   Navegação em **pilha de views** (lista → item → detalhe) com "voltar" previsível
   e estado preservado (scroll, seleção).
3. **Drawer → sheet.** O drawer lateral do desktop (`UX_PRINCIPLES §2.3`) vira
   **bottom-sheet** (ou **full-sheet** para conteúdo denso) no mobile — use o
   componente `Sheet` (`@/shared/components/Sheet`). Handle de arraste,
   `Esc`/swipe-down/backdrop para fechar, focus-trap e restauração de foco.
4. **Tabela → cards.** Tabelas densas viram **lista de cards** escaneáveis (campos-
   chave + ação primária no corpo). Filtros vão para **bottom-sheet de filtros**;
   ordenação por chip; paginação infinita.
5. **Toque de verdade.**
   - Alvos ≥ **44×44px** (`.touch-target`). Sem ação só por hover — todo hover tem
     equivalente de toque.
   - Inputs com `font-size ≥ 16px` (globals.css já força abaixo de `md`) para
     evitar o auto-zoom do iOS.
   - **Safe-area** (`.pt-safe`/`.pb-safe`/`.pl-safe`/`.pr-safe`) em qualquer
     elemento que toque a borda do device (notch, barra de gestos).
6. **Gestos naturais, não obrigatórios.** Swipe para ações de lista
   (arquivar/atribuir) e troca de coluna no kanban — **sempre** com equivalente por
   toque (descobribilidade). O gesto acelera; nunca é o único caminho.
7. **Feedback e performance.** Skeletons (`UX_PRINCIPLES §2.7`), transições
   **< 250ms** e sempre `motion-safe` (respeita `prefers-reduced-motion`).
   Orçamento de performance mobile: Lighthouse mobile ≥ 90; bundle por rota enxuto;
   lazy de canvas/charts.
8. **PWA instalável.** Manifest + ícones + `display: standalone`; "Adicionar à tela
   inicial" parece app nativo. (Casca e manifest entram em F36-S02.)
9. **Continuidade desktop↔mobile.** Mesmos tokens, mesma identidade. O mobile não é
   uma versão pobre — é o mesmo produto para o toque.

---

## 2. Padrões por arquétipo (como cada classe de tela vira mobile)

| Arquétipo | Padrão mobile |
|---|---|
| **Casca/nav** | Bottom tab bar (≤5 destinos) + drawer "Mais" + TopBar compacto + safe-area + PWA |
| **Cockpit/inbox** | Pilha de views: Lista → Thread → Cockpit (sheets). Composer fixo no rodapé com `pb-safe`. AgentSelector/Routing/Snooze viram `Sheet` |
| **Kanban** | Seletor de estágio (chips/segmented) + lista vertical de cards; mover por toque (menu) ou swipe; card → `Sheet` |
| **Tabela densa** | Lista de cards (campos-chave + ação primária); filtros/sort em bottom-`Sheet`; paginação infinita |
| **Detalhe c/ abas** | Abas roláveis (scroll-x) ou segmented; conteúdo empilhado; ações no rodapé |
| **Wizard** | 1 grupo por view, progresso no topo, CTA fixo no rodapé, autosave entre steps (`UX_PRINCIPLES §2.8`) |
| **Canvas (Flow)** | Mobile = **inspecionar/operar**, não desenhar: pan/zoom read-first, lista de nodes, inspector como full-`Sheet`. Edição estrutural degrada honestamente em < tablet |
| **Calendário** | Grade de mês → **agenda/dia** rolável; criar evento em `Sheet` |
| **Dashboard** | Grid → coluna única; cards full-width; charts responsivos (lazy) |
| **Forms/Settings** | Seções empilhadas/acordeão; save fixo no rodapé; inputs 16px |
| **Auth** | Centrado; polir paddings, teclado, safe-area, autofill |

---

## 3. Primitivos compartilhados (F36-S01)

### 3.1 `Sheet` — `@/shared/components/Sheet`

Bottom/full-sheet mobile. Substitui o drawer lateral do desktop quando `isMobile`.

```tsx
import { Sheet } from '@/shared/components/Sheet';

<Sheet
  open={open}
  onClose={() => setOpen(false)}
  variant="bottom"        // 'bottom' (default) | 'full'
  title="Detalhes"         // string → vira o aria-labelledby do dialog
  footer={<Button>Salvar</Button>}  // opcional: CTA fixo na zona do polegar
>
  {/* corpo rolável */}
</Sheet>
```

| Prop | Tipo | Default | Notas |
|---|---|---|---|
| `open` | `boolean` | — | Mantido montado na transição de saída. |
| `onClose` | `() => void` | — | Disparado por backdrop, `Esc`, X e swipe-down. |
| `variant` | `'bottom' \| 'full'` | `'bottom'` | `bottom`: até 90dvh, handle. `full`: tela cheia com safe-area. |
| `title` | `ReactNode` | — | `string` vira `aria-labelledby`. |
| `ariaLabel` | `string` | — | Rótulo a11y quando o título não é texto. |
| `footer` | `ReactNode` | — | Área fixa no rodapé (acima da safe-area). |
| `hideCloseButton` | `boolean` | `false` | Esconde o X (swipe/backdrop/Esc seguem fechando). |
| `className` | `string` | — | Classe extra do painel. |

Garantias de a11y/UX: `role="dialog"` + `aria-modal`, focus-trap, foco entra ao
abrir e **restaura ao gatilho** ao fechar, scroll do body travado, animação
`motion-safe` < 250ms, SSR-safe (portal só no cliente).

### 3.2 `useBreakpoint` / `useMediaQuery` — `@/shared/hooks`

```ts
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';

const { breakpoint, isMobile, isTablet, isDesktop, isBelowDesktop } = useBreakpoint();
const isWide = useMediaQuery('(min-width: 1280px)');
```

- `breakpoint`: `'mobile'` (< 768) | `'tablet'` (768–1023) | `'desktop'` (≥ 1024).
- SSR-safe (sem flash nem warning de hydration) via `useSyncExternalStore`; o
  snapshot do servidor é `false` → o **layout-base é mobile** e melhora para desktop.
- Reage a resize/rotação via `matchMedia`.

> **Regra de ouro:** o corte mobile é decidido **por `isMobile`**, não por classes
> Tailwind ad-hoc nem por `window.innerWidth`. Layout que só muda de aparência pode
> usar `md:`; layout que troca de **estrutura/comportamento** (renderiza `Sheet` vs
> drawer, pilha de views vs cockpit) usa `useBreakpoint()`.

### 3.3 Utilitárias CSS — `apps/web/app/globals.css`

| Classe | Efeito |
|---|---|
| `.pt-safe` `.pb-safe` `.pl-safe` `.pr-safe` | `padding-*: env(safe-area-inset-*)` por lado. |
| `.pt-safe-4` `.pb-safe-4` | `calc(1rem + env(safe-area-inset-*))` — mínimo + inset. |
| `.touch-target` | `min-width/height: 44px` — alvo de toque mínimo. |
| (global < `md`) | `input/select/textarea { font-size: 16px }` — evita zoom iOS. |

---

## 4. Checklist mobile (Definition of Done — slots F36)

Além do checklist de `UX_PRINCIPLES §4`:

- [ ] Layout que **troca de estrutura** usa `useBreakpoint().isMobile`, não número solto.
- [ ] Drawer/inspector vira `Sheet` no mobile (não modal-cobre-tudo).
- [ ] Ação primária da tela acessível na zona do polegar (rodapé).
- [ ] Alvos interativos ≥ 44×44px (`.touch-target` onde necessário).
- [ ] Bordas que tocam o device usam safe-area (`.pb-safe`/`.pt-safe`/…).
- [ ] Inputs ≥ 16px no mobile (default do globals.css; não sobrescrever para menos).
- [ ] Gesto (swipe) sempre tem equivalente por toque visível.
- [ ] Animações `motion-safe` e < 250ms; respeita `prefers-reduced-motion`.
- [ ] Empty/loading(skeleton)/error implementados também no layout mobile.
- [ ] Zero regressão de desktop (md+ inalterado).
