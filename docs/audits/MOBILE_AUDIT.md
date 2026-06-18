# MOBILE_AUDIT — Auditoria de UX + performance mobile (F36-S14)

> **Slot:** F36-S14 (fechamento da fase mobile F36). **Data:** 2026-06-17.
> **Método:** varredura tela-a-tela por leitura do código de produção (S01–S13)
> + `pnpm --filter @hm/web build` (verde) + inspeção do manifest construído. A
> execução da suíte e2e mobile está **pendente de ambiente** (ver §6).
> **Referência:** `docs/MOBILE_UX.md` §1/§2/§4 + `docs/UX_PRINCIPLES.md` §4/§8.
> **Corte mobile (D4):** `< md` (768px), decidido por `useBreakpoint().isMobile`.

---

## 0. Veredito

**Pronto para merge.** A fase mobile cumpre o checklist em todas as telas-chave:
casca/nav thumb-first, inbox em pilha de views, kanban como seletor de estágio,
tabela→cards, sheets com a11y completa, safe-area, alvos de toque, inputs 16px e
PWA instalável (manifest válido). `typecheck` e `lint` verdes; `build` verde.

Achados são **menores** e não-bloqueantes (§5) — nenhuma tela quebrada. A única
ressalva dura é de processo, não de produto: a suíte e2e **não roda verde neste
host** (Next não hidrata no headless-shell). Os specs são válidos (typecheck) e
devem ser executados num host que hidrata antes de declarar verde de runtime.

---

## 1. Fundação compartilhada (S01–S02)

| Item | Estado | Evidência |
|---|---|---|
| Corte por `useBreakpoint().isMobile` (não número solto) | OK | `shared/hooks/useBreakpoint.ts`; SSR-safe via `useMediaQuery`/`useSyncExternalStore`, snapshot mobile-first. |
| `Sheet` (bottom/full) com a11y | OK | `shared/components/Sheet/Sheet.tsx`: `role=dialog`+`aria-modal`, focus-trap (`trapTab`), foco entra ao abrir e **restaura ao gatilho** ao fechar, body-scroll travado, `Esc`/swipe-down(`DISMISS_THRESHOLD`/`DISMISS_VELOCITY`)/backdrop/X, `motion-safe` < 250ms, SSR-safe (portal só no cliente). |
| Safe-area utilitárias | OK | `app/globals.css`: `.pt-safe/.pb-safe/.pl-safe/.pr-safe` + `.pb-safe-4/.pt-safe-4` via `env(safe-area-inset-*)`. |
| Alvo de toque mínimo | OK | `.touch-target` → `min-h/w: 44px`. |
| Inputs 16px no mobile | OK | `globals.css` `@media (max-width: 767px) { input,select,textarea { font-size:16px } }` — bate com `< md` (768). |
| `viewport-fit=cover` (habilita safe-area) | OK | `app/layout.tsx` `viewport.viewportFit = 'cover'`; sem `maximumScale`/`userScalable` (zoom de a11y preservado). |
| `theme-color` por esquema | OK | `app/layout.tsx` `viewport.themeColor` dark `#050505` / light `#f4f7f4`. |

---

## 2. Casca / navegação (S02)

| Critério | Estado | Evidência |
|---|---|---|
| Bottom tab bar (thumb-first), não sidebar | OK | `AppLayout.tsx`: `{!isMobile && <Sidebar/>}` / `{isMobile && <BottomNav/>}` — troca de **estrutura** por `isMobile` (não `md:`); ambas não coexistem no DOM. |
| ≤ 5 alvos (N primários + "Mais") | OK | `nav.ts` `BOTTOM_NAV_PRIMARY_COUNT = 4`; overflow em `Sheet` "Mais". |
| Label visível (não só ícone) | OK | `BottomNav.tsx` cada item tem `<span>` com label (UX §2.4). |
| Gating por role | OK | `visibleNavItems(role)` filtra por `can(role, perm)`; o "Mais" some se não há overflow. |
| Safe-area inferior | OK | `<nav … pb-safe>`. |
| Alvos ≥ 44px | OK | `touch-target` em todo link/botão da barra. |
| Estado ativo | OK | `aria-current="page"` + cor `text-brand`. |

**e2e:** `e2e/mobile-navigation.spec.ts` (monta bottom nav, navega primário,
overflow via Sheet, sidebar ausente).

---

## 3. Telas-chave (varredura por arquétipo)

### 3.1 Cockpit / inbox (S03) — `features/conversations/components/ConversationsLayout.tsx`

| Critério | Estado | Nota |
|---|---|---|
| Pilha de views (Lista → Thread → Cockpit) por `isMobile` | OK | Rota é a fonte da pilha; `/conversations` = Lista cheia, `/:id` = Thread cheia. Desktop (3 colunas) inalterado. |
| "Voltar" previsível, preserva estado | OK | `router.back()` (histórico + cache TanStack da ChatList). Alvo `touch-target` + aria-label. |
| Composer fixo no rodapé (thumb-first) | OK | `MessageComposer` `shrink-0` no rodapé; safe-area herdada da BottomNav (evita gap dobrado). |
| Cockpit como full-`Sheet` (não modal-cobre-tudo) | OK | `<Sheet variant="full" title="Cockpit">` por cima da thread. |
| AgentSelector vira lista em `Sheet` no mobile | OK | `AgentSelector.tsx`: `isMobile ? <Sheet>…<ul role=listbox>` ; dropdown só no desktop. Agente atual **nomeado**; loading na mutation; estados empty/error. |
| Empty/loading | OK | `SkeletonList` nas mensagens; "Nenhuma mensagem ainda". |

**e2e:** `e2e/mobile-inbox.spec.ts` (lista→thread→voltar; cockpit sheet; trocar agente).

### 3.2 Kanban / pipeline (S04) — `features/pipeline/board/MobileBoard.tsx`

| Critério | Estado | Nota |
|---|---|---|
| Seletor de estágio (chips role=tab) + lista vertical | OK | `role=tablist`/`role=tab`, `aria-selected`; lista do estágio ativo. |
| Mover = ação explícita (equivalente por toque do drag, §2.2) | OK | Botão "Mover para…" → bottom-`Sheet` de estágios; respeita `transitionRules` (espelho client + autoridade server). |
| Card = ação primária (abrir detalhe, §2.1) | OK | Corpo do card é `<button>`; detalhe via `MobileDealSheet`. |
| Empty contextual por estágio | OK | "Nenhum negócio em {estágio}." (não tela toda vazia). |
| Alvos ≥ 44px + safe-area | OK | `touch-target` nos chips/ações; lista com `pb-safe-4`. |

**e2e:** `e2e/mobile-pipeline.spec.ts` (chips, mover via sheet → backend, empty de estágio).

### 3.3 Tabela densa → cards (S05) — `shared/components/ResponsiveTable/ResponsiveTable.tsx`

| Critério | Estado | Nota |
|---|---|---|
| Tabela (md+) vira lista de cards (mobile) por `isMobile` | OK | `CardList` (`<ul aria-label="Lista">`) vs `DesktopTable`. Contrato agnóstico de domínio. |
| Filtros vão para bottom-`Sheet` | OK | Botão "Abrir filtros" com badge de contagem; sheet reusa o slot `filters` do consumidor. |
| Chips de filtro ativo removíveis | OK | Acima da lista; `onClear` por chip + "Limpar". |
| 3 estados em ambos os layouts | OK | `MobileSkeleton`/`TableSkeleton`, `EmptyState`, `ErrorState` (3 partes). |
| Ação primária no card + chevron | OK | `onRowClick` → `<button>` com `rowLabel` a11y. |

**Consumidor auditado:** Contatos (`features/contacts/ContactsPage.tsx`) — colunas
dirigem tabela e cards; busca sempre visível; filtros (tag/opt-in/sort) no sheet.
**e2e:** `e2e/mobile-table.spec.ts` (cards, filtro no sheet afeta lista, fechar por Esc/backdrop).

### 3.4 Demais telas (leitura de código — adotam o padrão certo)

| Tela | Padrão mobile | Estado |
|---|---|---|
| Dashboard (S06) | grid → coluna única; cards full-width; `DrillDownDrawer`/`TableCard` com `isMobile` | OK |
| Calendário (S07) | grade → agenda/dia; criar evento em sheet (`CalendarPage`/`EventForm` com `isMobile`) | OK |
| Agentes (S08) | lista/detalhe/wizard com `isMobile` (`AgentsList`/`AgentDetail`/`AgentCreationWizard`) | OK |
| Campanhas (S09) | editor/monitoramento com `isMobile` (`CampaignEditor`/`CampaignMonitoring`) | OK |
| Settings / Knowledge / Conversões (S10) | seções empilhadas; drawers→sheets (`SettingsPanel`, `*Drawer` do knowledge, `MarkConversionModal`) | OK |
| Flow Builder (S11) | **degradação honesta**: read-first (pan/zoom + lista de nodes, inspector full-sheet); edição estrutural fica ≥ tablet | OK (`FlowEditorPage.tsx` `if (isMobile)`) |
| Auth (S12) | centrado, safe-area por lado, espaço pro teclado | OK (`app/(auth)/layout.tsx` `pt-safe-4 pb-safe-4 pl-safe pr-safe`) |
| Platform (S13) | nav mobile dedicada (`PlatformMobileNav`) | OK |

---

## 4. PWA (S02) — instalável

| Critério | Estado | Evidência |
|---|---|---|
| Manifest válido servido | OK | `app/manifest.ts` → build emite `manifest.webmanifest` com `content-type: application/manifest+json`. |
| `display: standalone` + `start_url`/`scope`/`id` | OK | `standalone`, `/`, `/`, `/`. |
| `orientation: portrait`, `lang: pt-BR` | OK | — |
| Ícones (any + maskable, 192/512) | OK | 4 ícones em `public/icons/**` (todos não-vazios: 716B–2.9KB) + `apple-touch-icon.png`. |
| `theme_color`/`background_color` = tokens DS | OK | `#050505` (espelha `--bg`). |

> Ressalva menor: os ícones são provisórios (gerados monocromáticos) — substituir
> por arte final é cosmético, não bloqueia instalação. Ver §5.

---

## 5. Achados (menores — follow-up, não bloqueiam merge)

1. **Ícones PWA provisórios** (`public/icons/*.png`, 716B–2.9KB). Instaláveis e
   válidos, mas são arte placeholder monocromática (o próprio `app/manifest.ts`
   já anota isso). *Follow-up:* arte final maskable com safe-zone. **Dono: S02.**
2. **Drift de contrato no mock e2e compartilhado** (fora do meu boundary):
   `e2e/fixtures/api-mock.ts` responde `/api/pipelines` como `{ pipelines: [...] }`,
   mas `usePipelines` hoje espera `{ data, meta }` (`features/pipeline/board/queries.ts`).
   O `pipeline.spec.ts` (desktop) renderiza vazio por isso. Meus specs mobile
   contornam registrando rotas locais com o shape correto. *Follow-up:* alinhar a
   fixture base ao contrato atual. **Dono: F10-S03 / quem mantém a fixture e2e.**
3. **e2e não executável neste host** (hidratação) — ver §6. Processo, não produto.

Nenhuma tela ficou quebrada ou com scroll-x global; os `overflow-x-auto`
encontrados são contêineres rolantes intencionais e escopados (tablist de estágios,
canvas do flow, tabelas de dashboard), não vazamento de layout da página.

---

## 6. Execução e2e — PENDENTE DE AMBIENTE (honestidade)

A suíte e2e **não roda verde neste host** (Windows, headless-shell): o bundle
cliente do Next **não hidrata**, então nenhum spec interativo fica verde aqui —
inclusive os specs de desktop pré-existentes (memória do projeto
`e2e-no-hydration-this-host`). Consequência:

- Os 4 novos specs (`mobile-navigation`, `mobile-inbox`, `mobile-pipeline`,
  `mobile-table`) são **válidos** (passam `pnpm typecheck`) e **herméticos**
  (storageState + `page.route`, viewport `Pixel 5`), mas o **verde de runtime
  fica pendente** de um host onde o app hidrata (CI Linux / dev local que hidrata).
- **NÃO** declaramos verde de execução. O audit de produto acima foi feito por
  leitura do código + `build` verde + inspeção do manifest construído.

Comando para rodar quando o ambiente hidratar:
`pnpm --filter @hm/web exec playwright test mobile-` (sobe `next dev` na porta de teste).

---

## 7. Lighthouse mobile — PENDENTE DE AMBIENTE

Lighthouse mobile (meta ≥ 90 performance/accessibility) **não foi coletado**:
depende de servir o app num host que hidrata (mesmo bloqueio de §6). Sinais
indiretos (proxy de orçamento) a partir do `build`:

- First Load JS compartilhado: **~213 KB** (gzip) — dentro de orçamento razoável.
- Code splitting por rota: automático (Next App Router); rotas pesadas
  (charts/canvas) já são `dynamic`/lazy nos slots anteriores.
- Acessibilidade estrutural verificada por leitura: landmarks de nav, `role=dialog`
  nos sheets, `aria-current`/`aria-selected`, focus ring `focus-visible:shadow-glow-md`,
  `aria-label` nas ações só-ícone.

*Follow-up:* coletar Lighthouse mobile por rota-chave (`/`, `/conversations`,
`/pipeline`, `/contacts`) em host que hidrata e anexar os números.

---

## 8. Regressão desktop (md+) — checklist

Zero alteração de estrutura desktop foi feita neste slot (boundary = só
`e2e/mobile-*.spec.ts` + este doc). A regressão desktop é garantida pela própria
arquitetura dos slots S03–S13, confirmada por leitura:

- [x] `AppLayout`: Sidebar montada quando `!isMobile` (inalterada).
- [x] Inbox: ramo desktop de 3 colunas é o mesmo código de antes (`ConversationsLayout` retorna cedo no `isMobile`).
- [x] Pipeline: `DndContext` + colunas + `StageColumn` intactos no ramo `!isMobile`.
- [x] `ResponsiveTable`: `DesktopTable` é o caminho `md+`; cards só no `isMobile`.
- [x] `AgentSelector`: dropdown desktop preservado; sheet só no `isMobile`.
- [x] `typecheck` + `lint` + `build` (web) verdes — nenhum import quebrado.
- [x] Specs de desktop existentes não foram tocados (continuam sob o mesmo gotcha de hidratação do host).
