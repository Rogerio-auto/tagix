# DESIGN_SYSTEM — Highermind v2

> **Documento:** Design System v2, frontend, identidade visual
> **Versão:** 0.1 — 2026-06-06
> **Base canônica:** `docs/design-system/DESIGN_SYSTEM.html` (showcase v1) + `docs/design-system/README.md` (v1)
> **Diferença vs v1:** v2 nasce com o sistema integrado ao código. Sem coexistência com tema legado.

---

## 1. Princípios

1. **Dark-first.** Default `data-theme="dark"`. Light é igual de polido, não inferior.
2. **Verde-neon é precioso no produto.** Um por tela. Botão de ação principal + status + marca. Nunca decorativo.
3. **Tipografia editorial.** Rajdhani (heads), Manrope (corpo), Chakra Petch (preços/números), Orbitron (logo/selos).
4. **Tokens semânticos em CSS.** Componentes consomem `--bg`, `--surface`, `--text`, `--brand`. Nunca hex hardcoded em JSX/TSX.
5. **Estados obrigatórios em todo interativo.** default, hover, active, focus, loading, disabled. Focus ring sempre presente.
6. **Animação respeita `prefers-reduced-motion`.**
7. **Não inventar marca.** Sem nome de produto definido ainda. Wordmark é `◢` ou `◢ DS`.

---

## 2. Tokens

### 2.1 Primitivos (theme-agnostic, vivem no `:root`)

```css
:root {
  /* Cor de marca */
  --brand:           #1FFF13;
  --brand-strong:    #16E00A;   /* hover / pressed */
  --brand-bright:    #5BFF51;   /* highlights, métricas */
  --brand-price:     #25F018;   /* preços (landing) */
  --brand-soft:      #7FEB7B;   /* destaque em títulos */
  --brand-faint:     #ABFFA7;   /* highlights claros */

  /* Estados */
  --danger:          #FF4D4D;   --danger-bg:      #2A0E0E;
  --warn:            #FFC53D;   --warn-bg:        #2B1D00;
  --info:            #3DA8FF;   --info-bg:        #0A1A2A;
  --success:         #25F018;   --success-bg:    #08200A;

  /* Tipografia */
  --font-display:    'Orbitron', system-ui, sans-serif;
  --font-price:      'Chakra Petch', monospace, sans-serif;
  --font-head:       'Rajdhani', system-ui, sans-serif;
  --font-body:       'Manrope', system-ui, sans-serif;

  /* Raio */
  --r-xs: 6px;   --r-sm: 10px;   --r-md: 14px;   --r-lg: 20px;   --r-pill: 999px;

  /* Espaçamento (base-8 + extras) */
  --sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;   --sp-4: 16px;
  --sp-5: 24px;  --sp-6: 32px;  --sp-7: 48px;   --sp-8: 64px;   --sp-9: 96px;
}
```

### 2.2 Semânticos (mudam por tema)

```css
:root, [data-theme="dark"] {
  --bg:            #050505;
  --bg-alt:        #0A0A0A;
  --surface:       #101311;
  --surface-2:     #161A17;
  --surface-3:     #1E231F;
  --surface-inset: #0C0E0D;

  --text:          #F2F5F2;
  --text-mid:      #B9C2BA;
  --text-low:      #7E867F;
  --text-on-brand: #04210A;

  --border:        #243026;
  --border-2:      #161C17;
  --border-brand:  #2BFF1F40;

  --elev-1: 0 1px 2px rgba(0,0,0,0.35);
  --elev-2: 0 2px 6px rgba(0,0,0,0.45);
  --elev-3: 0 4px 12px rgba(0,0,0,0.55);
  --elev-4: 0 8px 24px rgba(0,0,0,0.65);

  --glow-sm: 0 0 0 2px rgba(31,255,19,0.18);
  --glow-md: 0 0 0 3px rgba(31,255,19,0.25), 0 0 12px rgba(31,255,19,0.40);
  --glow-lg: 0 0 0 4px rgba(31,255,19,0.30), 0 0 24px rgba(31,255,19,0.55);
}

[data-theme="light"] {
  --bg:            #F4F7F4;
  --bg-alt:        #ECF1EC;
  --surface:       #FFFFFF;
  --surface-2:     #F4F7F4;
  --surface-3:     #E5EBE5;
  --surface-inset: #ECF1EC;

  --text:          #0C140D;
  --text-mid:      #4B5B4D;
  --text-low:      #7E867F;
  --text-on-brand: #04210A;

  --border:        #D3DCD4;
  --border-2:      #E5EBE5;
  --border-brand:  #1FFF1340;

  /* elev e glow ajustados para light */
}
```

### 2.3 Tailwind 4 preset

`packages/design-tokens/src/tailwind-preset.ts`:

```ts
import type { Config } from 'tailwindcss';

const preset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          strong: 'var(--brand-strong)',
          bright: 'var(--brand-bright)',
          soft: 'var(--brand-soft)',
          faint: 'var(--brand-faint)',
        },
        bg: 'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'surface-inset': 'var(--surface-inset)',
        text: 'var(--text)',
        'text-mid': 'var(--text-mid)',
        'text-low': 'var(--text-low)',
        'text-on-brand': 'var(--text-on-brand)',
        border: 'var(--border)',
        'border-2': 'var(--border-2)',
        'border-brand': 'var(--border-brand)',
        danger: 'var(--danger)',
        warn: 'var(--warn)',
        info: 'var(--info)',
        success: 'var(--success)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        price: 'var(--font-price)',
        head: 'var(--font-head)',
        body: 'var(--font-body)',
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
        'elev-4': 'var(--elev-4)',
        'glow-sm': 'var(--glow-sm)',
        'glow-md': 'var(--glow-md)',
        'glow-lg': 'var(--glow-lg)',
      },
    },
  },
};
export default preset;
```

Cada app (`apps/web`) importa esse preset no `tailwind.config.ts`.

---

## 3. Tipografia hierárquica

| Token | Família | Size | Weight | Tracking |
|---|---|---|---|---|
| H1 | head (Rajdhani) | 60px | 600 | -0.5px |
| H2 | head | 40px | 600 | -0.3px |
| H3 | head | 28px | 600 | -0.2px |
| H4 | head | 21px | 600 | -0.1px |
| body | body (Manrope) | 17px | 400 | 0 |
| small | body | 13px | 400 | 0.1px |
| price | price (Chakra Petch) | 40px | 600 | 0 |
| display | display (Orbitron) | 16px | 700 | 1.5px (caps) |

Corpo **nunca** em uppercase. Caixa-alta condensada só em heads e kickers curtos.

---

## 4. Componentes (primitives)

Ficam em `packages/ui/`. Cada um documentado com Ladle (`packages/ui/src/<Component>/<Component>.stories.tsx`).

### 4.1 Button

```tsx
<Button variant="primary" size="md" loading={isLoading}>Salvar</Button>
```

Variantes: `primary`, `secondary`, `ghost`, `danger`, `outline`, `link`.
Sizes: `sm`, `md`, `lg`.
Estados: default, hover (`hover:bg-brand-strong`), active (`active:scale-[0.98]`), focus (anel glow-md), loading (spinner inline, click bloqueado), disabled (`opacity-40 cursor-not-allowed`).

Tokens consumidos: `--brand`, `--text-on-brand`, `--surface-2`, `--text`, `--border`, `--danger`, `--glow-md`.

### 4.2 Input

```tsx
<Input
  label="Nome"
  placeholder="Como você quer ser chamado"
  error={errors.name?.message}
  hint="Aparece nas conversas"
  size="md"
/>
```

Estados: default, hover (border `--border-2` mais visível), focus (border `--brand` + `--glow-sm`), error (border `--danger`, hint vira `--danger`), disabled.

### 4.3 Card

```tsx
<Card elevation={2}>
  <CardHeader title="Sumário" action={<Button>Editar</Button>} />
  <CardBody>...</CardBody>
</Card>
```

Elevations: 1 (lista), 2 (padrão), 3 (hover/dropdown), 4 (modal).

### 4.4 Modal

Portal + backdrop + focus trap + esc/click-out fecha. ARIA roles corretos.

### 4.5 Tabs

Linear-style: barra inferior verde-neon na tab ativa.

### 4.6 Toast

**Único, em `packages/ui/src/Toast/`.** Não pode haver duplicação (lição v1).

Posições: top-right (notificações), bottom (confirmações ações). Padrão = top-right.

Variantes: success, error, warn, info. Cada uma com ícone Lucide.

### 4.7 Badge

```tsx
<Badge variant="success">Ativo</Badge>
<Badge variant="brand" subtle>Plano Pro</Badge>
```

### 4.8 Avatar

```tsx
<Avatar src={url} fallback="RG" size="md" />
```

Tamanhos: xs (24), sm (32), md (40), lg (56), xl (80). Fallback com gradient + iniciais.

### 4.9 Skeleton

```tsx
<Skeleton width="200px" height="20px" />
```

Animação shimmer respeitando `prefers-reduced-motion`.

### 4.10 Outros (lista; cada um terá sua story)

`Popover`, `Tooltip`, `DropdownMenu`, `Combobox`, `Switch`, `Checkbox`, `Radio`, `Slider`, `Progress`, `Spinner`, `Accordion`, `Tabs`, `Drawer`, `Sheet` (mobile bottom-sheet), `Lightbox`, `EmptyState`, `Pagination`, `Breadcrumb`, `Stat` (KPI card), `Snippet` (code block monospace).

---

## 5. Layout patterns

### 5.1 AppLayout (autenticado)

```
┌──────────────────────────────────────────────────┐
│  TopBar (mobile only): menu + breadcrumbs        │
├──────────┬───────────────────────────────────────┤
│ Sidebar  │            MainContent                 │
│ (240px)  │                                        │
│          │   ┌─PageHeader────────────────────┐   │
│ logo     │   │ title · action buttons        │   │
│ nav      │   ├───────────────────────────────┤   │
│ ...      │   │ tabs (opcional)               │   │
│          │   ├───────────────────────────────┤   │
│ avatar   │   │ content (cards, tabela, etc)  │   │
│ user     │   └───────────────────────────────┘   │
└──────────┴───────────────────────────────────────┘
```

Sidebar fixa em desktop (lg+), drawer em mobile. Tokens: `--bg`, `--surface`, `--text`. Active nav item: border-left brand + bg surface-3.

### 5.1.1 Largura de conteúdo (`<PageContainer>`)

O `<main>` do AppLayout **não** impõe `max-width` (só gutter lateral `px-4 lg:px-8`); em monitor ultrawide isso esticaria o conteúdo de ponta a ponta. A largura é responsabilidade do **`<PageContainer>`** (`shared/components/layout`), apoiado em tokens semânticos do preset:

| Token Tailwind         | Valor    | Uso                                                        |
|------------------------|----------|------------------------------------------------------------|
| `max-w-content`        | `1600px` | **Default** — toda página de fluxo (lista, detalhe, dashboard, settings). |
| `max-w-content-narrow` | `900px`  | Formulários e leitura focada (`variant="narrow"`).         |

```tsx
import { PageContainer } from '@/shared/components/layout';

// default (1600px, centralizado)
<PageContainer>{children}</PageContainer>
// form (900px)
<PageContainer variant="narrow">{form}</PageContainer>
// full-bleed (sem max-width)
<PageContainer variant="full">{canvas}</PageContainer>
```

**Exceção full-bleed:** telas que precisam ocupar toda a largura — **livechat (3 colunas), pipeline kanban, flow canvas, calendar** — usam `variant="full"` (ou não envolvem em `PageContainer`). Decisão travada: 1600px é o teto do conteúdo centralizado (monitor ultrawide; referência Linear/Stripe). O container só limita o fluxo principal; drawers/modais e a preferência de density não são afetados.


### 5.2 LiveChat layout (3 colunas)

```
┌────────┬───────────────┬─────────────┐
│Sidebar │  ChatList     │ Conversation│
│  app   │  + filters    │   header    │
│        │               │             │
│        │  conv 1       │ messages    │
│        │  conv 2 *     │             │
│        │  conv 3       │ composer    │
│        │               │             │
│        ├───────────────┤             │
│        │  ContactInfo  │             │
│        │  panel        │             │
└────────┴───────────────┴─────────────┘
```

ContactInfoPanel é toggle (botão no header da conversation).

### 5.3 Settings layout (nested routes)

Sidebar de settings à esquerda (sub-nav), conteúdo à direita.

### 5.4 Admin layout

Igual ao app layout mas com sidebar diferente (cor mais escura, branding "platform admin").

---

## 6. Iconografia

- **Lucide React** como library principal. Consistente, tree-shakeable, mantida.
- Tamanhos padrão: 16 (inline), 20 (button), 24 (header), 32 (large).
- Cor sempre `currentColor` por padrão (herda do contexto).

Logo do produto (quando precisar antes de naming): `◢` (Unicode U+25E2) em font-display.

---

## 7. Animação

- Lib: **Motion One** (`motion`). Light (<5kb), API simples.
- Transitions globais: cor 240ms, transform 200ms, opacity 180ms (curvas `ease-out` para entrar, `ease-in` para sair).
- Respeitar `prefers-reduced-motion: reduce` → animações decorativas viram instantâneas; loading spinners ficam (são funcionais).

Padrões comuns:

- **Toast in:** translateY(10px) + opacity(0) → translateY(0) + opacity(1), 240ms.
- **Modal in:** scale(0.96) + opacity(0) → scale(1) + opacity(1), 200ms.
- **Page transition:** opacity(0) → opacity(1), 180ms (sem deslocamento; respeita Linear-like).

---

## 8. Acessibilidade

### 8.1 Focus

- Anel de focus VISÍVEL sempre, em todos os elementos interativos.
- Anel para botões/inputs: `box-shadow: var(--glow-md)`.
- Anel para links/menus: `outline: 2px solid var(--brand); outline-offset: 2px`.

### 8.2 ARIA

- Modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`.
- Toast: `role="status"` (não-erro) ou `role="alert"` (erro).
- Live chat messages: container com `aria-live="polite"`.
- Form input: `aria-invalid`, `aria-describedby` apontando para hint/error.

### 8.3 Contraste

Texto principal: AAA (≥ 7:1).
Texto secundário: AA (≥ 4.5:1).
Validar com `npx accessible-pixels-cli` em CI.

### 8.4 Navegação por teclado

- Tab order correta em todos os formulários.
- Esc fecha modais/drawers.
- Enter em form submete.
- Setas em listas (ChatList) navegam.
- Cmd+K abre command palette (opcional MVP, mas estrutura preparada).

---

## 9. Estrutura do frontend (Next.js 15 App Router)

### 9.1 Pastas (Next App Router + feature-folders)

> Para o detalhe da estrutura `app/` completa, vide [`ARCHITECTURE.md` §11.2](./ARCHITECTURE.md#112-estrutura-app-router). Aqui o foco é design system + features.

```
apps/web/
├── app/                          # rotas + layouts (vide ARCHITECTURE §11.2)
│   ├── layout.tsx                # root: providers (Query, Theme, Toast); next/font; <html data-theme>
│   ├── globals.css               # @import tokens DS v2; reset
│   ├── (auth)/                   # rotas públicas (login, reset-password)
│   ├── (app)/                    # rotas autenticadas (sidebar + topbar)
│   └── platform/                 # super-admin (gate is_platform_admin)
│
├── shared/                       # primitives + utils universais
│   ├── components/               # Button, Input, Card, Modal, Toast, ... (DS v2)
│   │   └── ui/                   # base; server-safe quando possível
│   ├── hooks/                    # 'use client': useDebounce, useMediaQuery, useLocalStorage
│   ├── lib/
│   │   ├── api-client.ts         # fetch wrapper tipado com auth (server + client)
│   │   ├── query-client.ts       # 'use client' — TanStack Query setup
│   │   ├── socket.ts             # 'use client' — socket.io-client
│   │   ├── supabase-server.ts    # server-only (cookies, middleware)
│   │   ├── supabase-browser.ts   # 'use client'
│   │   └── cn.ts                 # className combiner (clsx + tailwind-merge)
│   ├── utils/
│   │   ├── format.ts             # currency, date, phone
│   │   └── validation.ts
│   └── icons/
│
├── features/                     # lógica por domínio (sem rotas; rotas vivem em app/)
│   ├── conversations/
│   │   ├── components/           # ChatList, ConversationPanel, MessageBubble/*, MessageComposer ('use client')
│   │   ├── server/               # server-only utils (load-conversations, etc.)
│   │   ├── hooks/                # 'use client': useConversations, useMessages, useChatSocket
│   │   ├── queries.ts            # TanStack queryKey factories
│   │   └── types.ts
│   ├── agents/
│   ├── flow-builder/             # FlowCanvas via dynamic() ssr:false; NodePalette; nodes/*; inspector/
│   ├── pipeline/
│   ├── campaigns/
│   ├── calendar/
│   ├── contacts/
│   ├── settings/
│   ├── dashboard/
│   └── platform-admin/
│
├── middleware.ts                 # auth check via Supabase cookie
├── next.config.mjs               # output: 'standalone', images.remotePatterns p/ R2
├── tailwind.config.ts
├── postcss.config.mjs
└── package.json
```

### 9.2 Roteamento (file-based App Router)

Sem arquivo `routes.tsx` central. As rotas são derivadas da estrutura de `app/`:

| URL | Arquivo |
|---|---|
| `/login` | `app/(auth)/login/page.tsx` |
| `/reset-password` | `app/(auth)/reset-password/page.tsx` |
| `/` (dashboard) | `app/(app)/page.tsx` |
| `/conversations` | `app/(app)/conversations/page.tsx` |
| `/conversations/:id` | `app/(app)/conversations/[id]/page.tsx` |
| `/agents` | `app/(app)/agents/page.tsx` |
| `/agents/new` | `app/(app)/agents/new/page.tsx` |
| `/agents/:id` | `app/(app)/agents/[id]/page.tsx` |
| `/agents/:id/playground` | `app/(app)/agents/[id]/playground/page.tsx` |
| `/flow-builder` | `app/(app)/flow-builder/page.tsx` |
| `/flow-builder/:id` | `app/(app)/flow-builder/[id]/page.tsx` (editor) |
| `/pipeline` | `app/(app)/pipeline/page.tsx` |
| `/campaigns` | `app/(app)/campaigns/page.tsx` |
| `/calendar` | `app/(app)/calendar/page.tsx` |
| `/contacts` | `app/(app)/contacts/page.tsx` |
| `/settings/*` | `app/(app)/settings/<sub>/page.tsx` |
| `/platform/*` | `app/(app)/platform/<sub>/page.tsx` (gate `is_platform_admin`) |

Layouts aninhados:
- `app/layout.tsx` → providers (TanStack, Theme, Toast); fontes via `next/font`; `<html data-theme>` via script inline antes do hydrate.
- `app/(auth)/layout.tsx` → layout enxuto centrado.
- `app/(app)/layout.tsx` → AppLayout (sidebar + topbar); valida sessão server-side; gates `is_platform_admin` em sub-rotas `/platform/*`.

Code splitting é automático **por rota** (RSC + Turbopack). Componentes pesados (`@xyflow/react`, `@fullcalendar/*`, `recharts`) carregados via `next/dynamic({ ssr: false })`.

### 9.3 State management

- **Server Components** carregam dado inicial (sem state client).
- **TanStack Query** para cache client-side + invalidate por socket events. SSR-prefetch via `HydrationBoundary` no Server Component pai.
- **Zustand** para estado global pequeno e estável (auth-snapshot, theme, command palette).
- **React Hook Form** para forms interativos client-side.
- **Server Actions (`'use server'`)** para mutations triviais (toggle de flag, delete simples) sem precisar de state local.
- **useState/useReducer** para estado local de componente.

**Nunca:** Redux, MobX, Recoil, Jotai (a menos que Rogério escolha diferente; default é Zustand).

### 9.4 Tema (sem flash)

Em `app/layout.tsx`, script inline no `<head>` aplica `data-theme` antes do React hydratar:

```tsx
// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=localStorage.getItem('hm:theme');var t=s||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;})();`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Zustand store `theme.store.ts` (em `'use client'`) controla mudança + persistência + sync com backend (`PATCH /api/members/me/theme`).

### 9.5 Forms

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const schema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  email: z.string().email('Email inválido'),
});
type FormData = z.infer<typeof schema>;

function CreateContactForm() {
  const form = useForm<FormData>({ resolver: zodResolver(schema) });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Input
        label="Nome"
        {...form.register('name')}
        error={form.formState.errors.name?.message}
      />
      <Input
        label="Email"
        {...form.register('email')}
        error={form.formState.errors.email?.message}
      />
      <Button type="submit" loading={form.formState.isSubmitting}>Salvar</Button>
    </form>
  );
}
```

### 9.6 Data fetching

```ts
// features/conversations/queries.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export function useConversations(filters: ListFilters) {
  return useQuery({
    queryKey: ['conversations', filters],
    queryFn: () => api.get('/api/conversations', { params: filters }),
  });
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => api.post(`/api/conversations/${conversationId}/read`),
    onSuccess: (_, conversationId) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
    },
  });
}
```

### 9.7 Socket integration

```ts
// core/socket/useSocketEvent.ts
export function useSocketEvent<T>(event: string, handler: (data: T) => void) {
  const socket = useSocketContext();
  useEffect(() => {
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [event, handler]);
}

// features/conversations/hooks/useConversationSocket.ts
export function useConversationSocket(conversationId: string) {
  const qc = useQueryClient();
  useSocketEvent<NewMessagePayload>('message:new', (payload) => {
    if (payload.conversationId === conversationId) {
      qc.setQueryData(['conversation', conversationId, 'messages'], (old: any) => {
        return old ? [...old, payload.message] : [payload.message];
      });
    }
  });
}
```

---

## 10. Templates de tela (specs visuais)

Listadas aqui de forma compacta. Versões em alta-fidelidade em Figma (fora deste pacote).

### 10.1 ChatList item

```
┌──────────────────────────────────────┐
│ [Avatar]  Nome do contato       2min │  ← `text-mid` + `text-low`
│           última mensagem...   [3]  │  ← `text-low` + badge verde se unread
│           [dept][tag]                │  ← chips pequenos
└──────────────────────────────────────┘
```

Hover: bg `--surface-2`. Active: bg `--surface-3` + border-left brand 2px.

### 10.2 MessageBubble

- **Inbound:** alinhada à esquerda, bg `--surface-2`, radius `--r-md` (canto inferior esquerdo 4px).
- **Outbound:** alinhada à direita, bg `--brand` desbotado (`color-mix`) ou `--surface-3` + texto `--text`, radius `--r-md` (canto inferior direito 4px).
- **System:** centralizada, font `--font-display` em caps pequena, cor `--text-low`.
- Status icon canto inferior direito: clock (pending), check (sent), double-check (delivered), eye verde (read).

### 10.3 Empty states

Toda lista vazia tem empty state com:
- ícone Lucide grande, cor `--text-low`
- título Rajdhani 28px
- descrição Manrope 17px
- 1 botão de ação principal

Exemplo "Nenhuma conversa":

```
        [MessageSquare 48px]
       Nenhuma conversa ainda
   Quando alguém te escrever no WhatsApp,
        as conversas aparecem aqui.
            [Conectar canal]
```

### 10.4 Loading states

- Lista: 3-5 Skeleton cards.
- Conversa: 8-10 Skeleton bubbles alternando esquerda/direita.
- Botão de ação: spinner inline + texto preservado, mas opacity 70%.

---

## 11. Painel de ajuda integrado

Lição do PRD: "documentação de ajuda integrada".

Cada feature tem `(?)` no canto superior direito do PageHeader. Clica → abre drawer lateral (`Sheet`) com:

- Título da feature
- 3-5 parágrafos curtos explicando
- 2-3 GIFs/screenshots ilustrativos
- Link "Ver doc completo" → externo (Docusaurus/Mintlify fora do escopo MVP, mas hook está pronto)
- Botão "Falar com suporte" (futuro)

Conteúdo da ajuda mora em `apps/web/src/features/<feat>/help.tsx` para ficar perto do código.

---

## 12. Storybook / Ladle

`packages/ui/.ladle/`:

```bash
pnpm --filter ui ladle serve     # roda Ladle em :61000
```

Cada componente em `packages/ui/src/<Component>/` tem `.stories.tsx`:

```tsx
import { Button } from './Button';

export const Primary = () => <Button variant="primary">Primary</Button>;
export const Loading = () => <Button variant="primary" loading>Loading</Button>;
export const States = () => (
  <div className="flex gap-2">
    <Button variant="primary">Default</Button>
    <Button variant="primary" disabled>Disabled</Button>
    <Button variant="primary" loading>Loading</Button>
  </div>
);
```

Stories são fonte de testes visuais via Chromatic ou Percy (fase 2).

---

## 13. Checklist de aprovação de feature (antes de mergear)

- [ ] Zero hex hardcoded em JSX/TSX (todos os `bg-*`, `text-*`, `border-*` usam tokens).
- [ ] default + hover + active + focus + loading + disabled implementados em interativos.
- [ ] Focus ring visível e acessível.
- [ ] Funciona em `data-theme="dark"` E `data-theme="light"`.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] Verde-neon `--brand` aparece no máximo 1 vez por tela (CTA principal). Status badges/chips podem usar tons de marca soft/faint.
- [ ] Componente novo tem story em Ladle.
- [ ] Form usa React Hook Form + Zod.
- [ ] Empty state implementado se a lista pode vir vazia.
- [ ] Loading state implementado.
- [ ] Error state implementado.
- [ ] `(?)` no PageHeader com painel de ajuda apontando para texto local.

---

## 14. Migração mental: termos v1 → v2

| v1 (legacy) | v2 (DS) |
|---|---|
| `--color-bg`, `--color-surface`, `--color-primary` | `--bg`, `--surface`, `--brand` |
| `.dark` (classe) | `data-theme="dark"` (atributo) |
| Inter, Space Grotesk | Manrope, Rajdhani, Chakra Petch, Orbitron |
| Verde médio `#2fb463` | Verde neon `#1FFF13` |
| `components/ui/*` (com cor legada) | `packages/ui/*` (tokens v2) |
| 2 ToastContainer | 1 Toast em `packages/ui/Toast` |
| `useFormValidation` manual | React Hook Form + Zod |
| 6 contextos React aninhados | 3-4 contextos + Zustand stores |

---

## 15. Fontes (carregadas em `index.html`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?
  family=Rajdhani:wght@500;600;700&
  family=Manrope:wght@400;500;600;700&
  family=Chakra+Petch:wght@500;600;700&
  family=Orbitron:wght@600;700;800&
  display=swap" rel="stylesheet">
```

Self-host opcional (Fontsource) em fase 2 para evitar dep externa.

---

## 16. Não-objetivos do MVP

- Storybook visual regression testing (depois)
- Theme builder UI (admin escolhe paleta) — depois
- Componentes "comerciais" (PricingTable, FeatureGrid, TestimonialCard) — só quando a landing entrar em escopo
- Drag-and-drop de form fields (form builder) — depois
- Internacionalização completa — PT-BR é o foco MVP; estrutura preparada (i18n via `react-i18next`) mas só `pt-BR` traduzido

---

## 17. Próximos passos após `/hm-init`

1. Criar `packages/design-tokens` com CSS variables + tailwind preset.
2. Criar `packages/ui` com 5 primitives essenciais: Button, Input, Card, Modal, Toast.
3. Setup Ladle no `packages/ui`.
4. Implementar `apps/web/index.html` com tokens + fontes + script de tema.
5. Implementar AppLayout com sidebar + topbar.
6. Migrar fluxo de login pra DS v2 (primeira tela end-to-end).
