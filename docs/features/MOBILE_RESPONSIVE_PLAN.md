# Mobile Responsive & PWA — Levantamento de Telas + Plano de UX

> **Data:** 2026-06-16
> **Origem:** founder — tornar o sistema **100% otimizado e responsivo para uso direto no celular, em TODAS as telas**. É o diferencial → a UX mobile tem que ser excepcional, não um "encolhe e empilha".
> **Contexto travado:** o `UX_PRINCIPLES §8` declarava _"sem responsive em mobile; mobile é fase 2 com PWA"_. **Esta é a fase 2.** O plano também promove o mobile a cidadão de primeira classe no DS/UX.
> **Status:** levantamento + plano para **aprovação**; decomposição em slots (proposta F36) detalhada na §6, materializada após o OK.

---

## 1. TL;DR

O app é **desktop-first** por decisão (telas de largura fixa, cockpit de 3 colunas, kanban horizontal, tabelas densas). A *casca* de navegação (`AppLayout`) já tem um esqueleto mobile (sidebar-drawer + hambúrguer no `TopBar`), mas o **conteúdo das telas não é responsivo**. Há só ~52 usos incidentais de breakpoint em 31 arquivos — nada sistemático.

Mobile excelente aqui não é CSS de última hora: cada **arquétipo de tela** precisa de um **padrão mobile próprio** (o cockpit vira navegação em pilha de views; tabela vira lista de cards; kanban vira seletor de estágio + lista; drawer vira bottom-sheet). O plano define esses padrões uma vez (primitivos compartilhados) e os aplica tela a tela, fechando com PWA instalável + auditoria de UX e performance mobile.

---

## 2. Levantamento — todas as telas (34 páginas / 3 grupos)

### Grupo `(auth)` — 2
| Tela | Rota | Arquétipo |
|---|---|---|
| Login | `/login` | form curto centrado |
| Reset de senha | `/reset-password` | form curto centrado |

### Grupo `(app)` — 21
| Tela | Rota | Arquétipo | Dificuldade mobile |
|---|---|---|---|
| Dashboard (home) | `/` | grid de cards + gráficos | média |
| Conversas (inbox) | `/conversations` | **cockpit 3 colunas** (lista+thread+painel) | 🔴 alta |
| Conversa | `/conversations/[id]` | thread + composer + cockpit | 🔴 alta |
| Pipeline | `/pipeline` | **kanban horizontal** | 🔴 alta |
| Pipeline settings | `/pipeline/settings` | form/estágios | média |
| Calendar | `/calendar` | grade de mês | alta |
| Agentes (lista) | `/agents` | cards/grid | baixa |
| Agente (detalhe) | `/agents/[id]` | abas (config/tools/metrics/playground/knowledge) | alta |
| Flows (lista) | `/flows` | lista + quickbar | baixa |
| Flow editor | `/flows/[id]` | **canvas ReactFlow** | 🔴 alta (especial) |
| Campanhas (lista) | `/campaigns` | tabela/cards | média |
| Campanha nova | `/campaigns/new` | **wizard** | média |
| Campanha (detalhe) | `/campaigns/[id]` | monitoring + métricas | média |
| Campanha edit | `/campaigns/[id]/edit` | wizard | média |
| Contatos | `/contacts` | **tabela densa** | alta |
| Conversões | `/conversions` | tabela + métricas | média |
| Knowledge | `/knowledge` | lista de docs + upload | média |
| Settings (índice) | `/settings` | navegação de seções | baixa |
| Settings · canais | `/settings/channels` | form/cards | média |
| Settings · calendar | `/settings/calendar` | form (regras/exceções) | média |
| Settings · conversões | `/settings/conversions` | form/lista | média |

### Grupo `(platform)` — 11 (admin)
`/platform` (home), `/platform/usage`, `/platform/models`, `/platform/policies`, `/platform/secrets`, `/platform/tenants` (+`/[id]`), `/platform/plans`, `/platform/subscriptions`, `/platform/impersonation`, `/platform/playground`.
→ Arquétipos: tabelas + editores. Uso majoritariamente desktop, mas precisa ficar **legível e operável** no celular (prioridade menor que o app).

---

## 3. Baseline de responsividade (o que já existe)

- **Casca:** `AppLayout` → `Sidebar` com `mobileOpen`/`onClose` (drawer) + `TopBar` com `onMenu` (hambúrguer) + `CommandPalette` (⌘K). A navegação primária **já tem esqueleto mobile** (drawer). `h-dvh` usado (bom p/ mobile).
- **Cockpit:** `ConversationsLayout` é 3 colunas fixas (`w-80` + flex + `w-80`) com `h-[calc(100dvh-7rem)]` — **trava em telas estreitas**.
- **Tabelas/kanban/canvas:** largura fixa, scroll horizontal, alvos pequenos — **não usáveis no toque**.
- **Drawers** (cockpit, RoutingMenu, AgentSelector, SnoozeMenu): largura/posição desktop.
- Breakpoints: ~52 ocorrências esparsas (platform shell, plans, alguns inspectors) — sem sistema.

**Conclusão:** a fundação de navegação ajuda, mas ~90% do esforço é no conteúdo das telas + primitivos compartilhados + gestos de toque + PWA.

---

## 4. Princípios de UX mobile (o diferencial)

Estende `UX_PRINCIPLES.md`. Inegociáveis no mobile:

1. **Thumb-first.** Ações primárias na zona do polegar (rodapé), não no topo. Nav primária = **bottom tab bar**; ações de tela = botão/área inferior fixa.
2. **Uma intenção por view.** Em telas estreitas, nada de 3 painéis simultâneos. Navegação em **pilha de views** (lista → item → detalhe), com "voltar" previsível e estado preservado.
3. **Drawer → sheet.** O drawer lateral do desktop (§2.3) vira **bottom-sheet** (ou full-sheet) no mobile, com handle de arraste, `Esc`/swipe-down/backdrop pra fechar.
4. **Tabela → cards.** Tabelas densas viram **lista de cards** escaneáveis; filtros vão pra **bottom-sheet de filtros**; ordenação por chip.
5. **Toque de verdade.** Alvos ≥ 44×44px; inputs com `font-size ≥ 16px` (evita zoom do iOS); sem ação *só* por hover (todo hover tem equivalente de toque); `safe-area-inset` (notch/barra).
6. **Gestos naturais, não obrigatórios.** Swipe pra ações de lista (arquivar/atribuir) e troca de coluna no kanban — sempre com equivalente por toque (descobribilidade).
7. **Feedback e performance.** Skeletons (§2.7), transições < 250ms, e **orçamento de performance mobile** (Lighthouse mobile ≥ 90; bundle por rota enxuto; lazy de canvas/charts).
8. **PWA instalável.** Manifest + ícones + tela inicial; `display: standalone`; (offline-shell opcional). "Adicionar à tela inicial" → parece app nativo.
9. **Continuidade desktop↔mobile.** Mesmos tokens DS v2, mesma identidade (dark-first, tipografia editorial). Mobile não é um app pobre — é o mesmo produto, redesenhado pra o toque.

---

## 5. Estratégia por arquétipo (como cada classe de tela vira mobile)

| Arquétipo | Padrão mobile | Telas |
|---|---|---|
| **Casca/nav** | Bottom tab bar (5 destinos) + drawer "Mais" + TopBar compacto + safe-area + PWA | todas |
| **Cockpit/inbox** | Pilha de views: Lista → Thread → Cockpit (sheets). Composer fixo no rodapé com safe-area. AgentSelector/Routing/Snooze viram sheets | `/conversations(/[id])` |
| **Kanban** | Seletor de estágio (chips/segmented) + lista vertical de cards do estágio; swipe ou menu pra mover; card → sheet | `/pipeline` |
| **Tabela densa** | Lista de cards (campos-chave + ação primária); filtros/sort em bottom-sheet; paginação infinita | contacts, campaigns, conversions, deals, members, tenants |
| **Detalhe c/ abas** | Abas roláveis (scroll-x) ou segmented; conteúdo empilhado; ações no rodapé | agents/[id], tenants/[id], campaign/[id] |
| **Wizard** | 1 grupo por view, progresso no topo, CTA fixo no rodapé, autosave entre steps (já é o padrão §2.8) | campaign new/edit, agent create, onboarding |
| **Canvas (Flow)** | Mobile = **inspecionar/operar**, não desenhar: pan/zoom read-first, lista de nodes, inspector como full-sheet, publicar/disparar; edição estrutural fica melhor em ≥ tablet (degradação honesta) | flows/[id] |
| **Calendário** | Grade de mês → **agenda/dia** rolável no mobile; criar evento em sheet | calendar |
| **Dashboard** | Grid → coluna única; cards full-width; charts responsivos (lazy) | `/` |
| **Forms/Settings** | Seções empilhadas/acordeão; save fixo no rodapé; inputs 16px | settings/*, pipeline/settings |
| **Auth** | Já centrado; polir paddings, teclado, safe-area, autofill | login, reset |

---

## 6. Decomposição proposta — Fase **F36 (Mobile Responsive & PWA)**

Raiz = primitivos (S01) + casca (S02). Depois, telas em paralelo por onda. ~14 slots.

### Onda A — fundação (sequencial; destrava tudo)
- **S01 — Primitivos responsivos** `[web/ui+design-tokens]`
  Breakpoints canônicos nos tokens; hook `useBreakpoint`/`useMediaQuery`; componente **`Sheet`** (bottom/full-sheet com handle, swipe-down, backdrop, focus-trap, `Esc`); utilitários de safe-area + alvo-de-toque; doc `MOBILE_UX.md` + atualização do `UX_PRINCIPLES §8`. *UX: §2.3→sheet, §2.7, §3.10.*
- **S02 — Casca mobile + PWA** `[web]`
  Bottom tab bar (destinos primários por role) + drawer "Mais"; `TopBar` responsivo; safe-area no shell; **manifest + ícones + installable** (+ offline-shell opcional). *UX: §2.4 path óbvio, §2.10 atalhos, thumb-first.* dep: S01.

### Onda B — telas de maior tráfego (paralelas após A)
- **S03 — Inbox/cockpit responsivo** 🔴 `[web/conversations]` — pilha de views (lista↔thread↔cockpit), composer fixo, sheets p/ AgentSelector/Routing/Snooze. dep: S01.
- **S04 — Pipeline/kanban responsivo** `[web/pipeline]` — seletor de estágio + lista + mover por toque; card→sheet. dep: S01.
- **S05 — Padrão Tabela→Cards + filtros em sheet** `[web/ui + listas]` — componente `ResponsiveTable`/`CardList` aplicado a contacts, campaigns, conversions (e base p/ deals/members/tenants). dep: S01.
- **S06 — Dashboard responsivo** `[web/dashboard]` — grid→coluna, charts responsivos/lazy. dep: S01.
- **S07 — Calendário responsivo** `[web/calendar]` — agenda/dia no mobile + criar em sheet. dep: S01.

### Onda C — telas secundárias (paralelas)
- **S08 — Agentes (lista + detalhe c/ abas)** `[web/agents]`. dep: S01 (S05 p/ abas).
- **S09 — Campanhas (lista + wizard + monitoring)** `[web/campaigns]`. dep: S01, S05.
- **S10 — Settings + Knowledge + Conversões** `[web/settings,knowledge,conversions]`. dep: S01, S05.
- **S11 — Flow Builder mobile (inspecionar/operar)** `[web/flow-builder]` — read-first + inspector full-sheet; edição estrutural degradada honestamente. dep: S01.
- **S12 — Auth (login/reset) polish mobile** `[web/auth]`. dep: S01.
- **S13 — Platform admin legível/operável no mobile** `[web/platform-admin]`. dep: S01, S05.

### Onda D — fechamento
- **S14 — QA mobile + designer audit + performance** `[qa]` — e2e Playwright em viewport mobile (fluxos-chave), auditoria `/hm-designer` do checklist `UX_PRINCIPLES §4` + os princípios mobile §4 deste doc, Lighthouse mobile ≥ 90, regressão desktop zero. dep: B+C.

**Grafo:** S01 → S02 → (S03…S07 ∥) ; S05 → (S08…S13 que usam tabela) ; tudo → S14.

---

## 7. Decisões a confirmar na aprovação
- **D1 — Flow Builder no celular:** edição estrutural **read-first/operar** (recomendado; desenhar grafo no toque é ruim) vs tentar edição completa.
- **D2 — PWA agora:** incluir manifest + installable nesta fase (recomendado — é o "usar direto no celular") vs só responsividade e PWA depois.
- **D3 — Plataforma admin:** "legível/operável" (recomendado, esforço menor) vs paridade total de UX mobile.
- **D4 — Breakpoint de corte do cockpit/kanban:** abaixo de `md` (768px) usa o padrão mobile; `md+` mantém desktop (recomendado).

> **Nota operacional:** há outra sessão Claude ativa neste mesmo working tree (F35). Para evitar a colisão de git já registrada em memória, a materialização dos slots F36 deve ocorrer quando o F35 estabilizar **ou** em git worktree isolado.
