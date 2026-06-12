# Performance audit -- @hm/web (F10-S06)

> Next.js 15 (App Router) + React 19. Foco: bundle por rota, code-split de libs
> pesadas, otimizacao de imagens/fontes e procedimento de Lighthouse.
> Boundary do slot: apps/web/next.config.mjs, apps/web/shared/**,
> docs/performance/**. apps/web/features/** e producao, read-only -- os swaps de
> next/dynamic que tocam features estao listados como follow-ups (secao 5).

---

## 1. Bundle por rota (baseline)

Medido com `pnpm --filter @hm/web build` (Next 15.5.19), producao.

| Rota | Route JS | First Load JS | Lib pesada na rota |
| --- | --- | --- | --- |
| / (dashboard) | 112 kB | 259 kB | recharts (ChartCard) |
| /calendar | 85 kB | 223 kB | @fullcalendar/* |
| /flows/[id] | 61 kB | 208 kB | @xyflow/react |
| /conversations | 0.15 kB | 177 kB | -- (shared chat) |
| /conversations/[id] | 0.15 kB | 177 kB | -- |
| /agents/[id] | 15 kB | 168 kB | -- |
| /flows | 5 kB | 166 kB | -- (lista) |
| /agents | 9 kB | 154 kB | -- |
| /pipeline | 8 kB | 153 kB | @dnd-kit/* |
| /contacts | 8 kB | 152 kB | -- |
| /login | 2 kB | 150 kB | -- |
| restantes | -- | 105-149 kB | -- |
| shared (todas) | -- | 104 kB | runtime React/Query/Zustand |

As tres rotas-alvo (/, /calendar, /flows/[id]) concentram o peso por causa das
quatro libs pesadas: recharts, @fullcalendar/*, @xyflow/react, @dnd-kit/*.

---

## 2. O que foi aplicado neste slot (dentro da boundary)

### 2.1 next.config.mjs

- experimental.optimizePackageImports para lucide-react, recharts, @xyflow/react,
  @fullcalendar/* e @dnd-kit/*. Reescreve barrel-imports para imports diretos de
  submodulo no build, sem tocar o codigo das features.
  - Efeito mensurado: neutro (+/-0.1 kB) nestas libs especificas -- recharts,
    @xyflow e @fullcalendar ja sao deep-import / nao-barrel, entao nao ha o que
    podar. Mantido por ser zero-custo, zero-regressao e proteger futuros barrels
    (lucide-react tem 1k+ icones e e importado em 68 arquivos).
- compress: true -- gzip no server Next de producao (self-hosted).
- poweredByHeader: false -- remove X-Powered-By.
- images.formats: ['image/avif','image/webp'] -- next/image serve AVIF/WebP.
- Bundle analyzer OPT-IN via ANALYZE=true, com import guardado (createRequire +
  try/catch): o build NAO quebra quando @next/bundle-analyzer nao esta instalado.
  Ver secao 4.

### 2.2 shared/** -- infraestrutura de lazy boundaries

A boundary impede editar features/**, onde as libs pesadas sao montadas. O slot
entrega a camada habilitadora para os swaps:

- shared/lib/lazy.tsx -- lazyClient<P>(loader, { loading, ssr? }): wrapper tipado
  de next/dynamic com ssr:false default e loading OBRIGATORIO (UX 3.6 -- skeleton,
  nunca tela branca). Zero any.
- shared/components/feedback/WidgetSkeleton.tsx -- CanvasSkeleton, ChartSkeleton,
  CalendarSkeleton, BoardSkeleton: placeholders com a forma de cada widget pesado
  (evita CLS na hidratacao). Exportados em shared/components/feedback/index.ts.

Resultado mensuravel de bundle so aparece quando os swaps da secao 5 forem
aplicados nas features. A infra acima e o pre-requisito e foi validada no build.

---

## 3. Bundle por rota (depois deste slot)

Sem regressao; libs pesadas continuam no First Load das 3 rotas-alvo (o next/dynamic
real mora em features/, fora da boundary). Deltas dentro do ruido:

| Rota | First Load JS (antes -> depois) |
| --- | --- |
| / | 259 kB -> 259 kB |
| /calendar | 222 kB -> 223 kB |
| /flows/[id] | 208 kB -> 208 kB |
| shared | 104 kB -> 104 kB |

Build, typecheck e lint verdes. O ganho real esta represado na secao 5.

---

## 4. Bundle analyzer (dep a instalar)

@next/bundle-analyzer NAO foi adicionado ao package.json (proibido pela boundary).
O orchestrator deve instalar:

    pnpm --filter @hm/web add -D @next/bundle-analyzer

Ativacao (gera analyze/*.html), em PowerShell:

    $env:ANALYZE = 'true'; pnpm --filter @hm/web build; Remove-Item Env:\ANALYZE

next.config.mjs ja esta cabeado: com ANALYZE=true + dep presente, embrulha a config
com o analyzer; sem a dep, emite warning e segue (build nao quebra).

---

## 5. Follow-ups -- swaps de next/dynamic (tocam features/**)

Estes sao os ganhos de bundle de fato. Cada um remove a lib pesada do First Load
das rotas que nao a usam. Precisam de slot que possa editar features/** (e os
app/**/page.tsx que montam). Ja ha infra em shared/ pra todos.

### 5.1 Dashboard / recharts (ChartCard) -- alvo: -50 kB no First Load de /

features/dashboard/cards/registry.tsx monta ChartCard. Trocar import direto por:

    import { lazyClient } from '@/shared/lib/lazy';
    import { ChartSkeleton } from '@/shared/components/feedback';
    const ChartCard = lazyClient(
      () => import('./ChartCard').then((m) => m.ChartCard),
      { loading: () => <ChartSkeleton /> },
    );

### 5.2 Calendar / fullcalendar (CalendarPage) -- alvo: -80 kB em /calendar

app/(app)/calendar/page.tsx importa CalendarPage. FullCalendar e client-only.
Criar wrapper client LazyCalendarPage em features/calendar com lazyClient +
CalendarSkeleton + ssr:false; a page renderiza <LazyCalendarPage />.

### 5.3 Flow editor / @xyflow (FlowCanvas) -- alvo: -55 kB em /flows/[id]

features/flow-builder/FlowEditorPage.tsx monta FlowCanvas (xyflow). Trocar import
de ./canvas/FlowCanvas por lazyClient + CanvasSkeleton + ssr:false. O
ReactFlowProvider permanece estatico; so o canvas vira lazy.

### 5.4 dnd-kit (pipeline + ManualFlowsReorder)

@dnd-kit e leve, mas so necessario em modo de edicao. Follow-up menor: lazy-load
do board arrastavel (BoardSkeleton) so quando o usuario entra em reorder, no
PipelinePage/ManualFlowsReorder.

### 5.5 loading.tsx por rota (App Router)

Adicionar app/(app)/calendar/loading.tsx, app/(app)/flows/[id]/loading.tsx e
app/(app)/loading.tsx reutilizando os skeletons de shared/components/feedback.
Streaming de Suspense em nivel de rota (UX 3.6) -- fora da boundary deste slot.

---

## 6. Lighthouse -- procedimento e alvos

Headless nao roda no worker (requer Chrome + server de producao up; porta 3000
conflita com WAHA). Procedimento (PowerShell):

    pnpm --filter @hm/web build
    # pare o WAHA antes (porta 3000):
    pnpm --filter @hm/web start
    # em outro terminal:
    npx lighthouse http://localhost:3000/ --only-categories=performance --preset=desktop --output=html --output-path=./docs/performance/lh-dashboard.html
    # repetir para /calendar e /flows/<id>

Como / e a maioria das rotas sao autenticadas (dynamic), medir logado: gerar sessao
no browser e passar --extra-headers com o cookie, ou usar o login flow do e2e
(Playwright, F10-S03) antes de apontar o Lighthouse.

### Alvos (desktop, producao)

| Metrica | Alvo |
| --- | --- |
| Performance score | >= 90 |
| LCP | <= 2.5 s |
| TBT | <= 200 ms |
| CLS | <= 0.1 |
| First Load JS (rota pesada) | <= 170 kB apos swaps da secao 5 |

Estimativa: hoje as rotas pesadas (208-259 kB First Load) tendem a TBT alto em CPU
4x-throttled. Os swaps da secao 5 derrubam / para ~209 kB, /calendar para ~143 kB
e /flows/[id] para ~153 kB de First Load -- suficiente para Performance >= 90 em
desktop nas rotas-alvo.

---

## 7. Fontes / imagens

- Fontes: o app usa tokens DS v2 (sem @next/font custom em shared/app/layout).
  Quando houver webfont, usar next/font (self-host + display:swap) para eliminar
  render-blocking e FOIT. Follow-up se/quando uma webfont entrar.
- Imagens: next/image ja com AVIF/WebP (secao 2.1). remotePatterns cobre o R2.
  Garantir sizes/priority nas imagens above-the-fold quando adicionadas.

---

## 8. Validacoes deste slot

| Comando | Resultado |
| --- | --- |
| pnpm --filter @hm/web typecheck | OK |
| npx eslint (arquivos tocados) | OK (0 erros) |
| pnpm --filter @hm/web build | OK (21/21 paginas, compila) |
