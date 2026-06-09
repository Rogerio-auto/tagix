---
id: F0-S10
title: "@hm/ui base — infra + Ladle + 5 primitives (Button, Input, Card, Modal, Toast)"
phase: F0
status: review
priority: critical
estimated_size: L
depends_on: [F0-S09]
agent_id: backend-engineer
claimed_at: 2026-06-09T11:37:19Z
completed_at: 2026-06-09T13:16:09Z

---
# F0-S10 — @hm/ui base (infra + 5 primitives + Ladle)

> Refina o ROADMAP F0-S09 (parte "5 primitives + Ladle"). Cohesivo de propósito: estabelecer a biblioteca + os 5 primitives num PR mantém o barrel e os contratos de variante internamente consistentes.
> **source_docs:** `docs/DESIGN_SYSTEM.md` §4, §6, §7, §8, §12; `docs/UX_PRINCIPLES.md` §2.3, §2.7, §2.9, §3.6, §3.10
> **blocks:** F0-S11, F0-S12, F0-S13

## Objetivo

Materializar `@hm/ui` como a biblioteca de primitives React do DS v2, documentada em Ladle, com os 5 componentes essenciais e o sistema de variantes/estados.

## Contexto

Hoje `packages/ui` é skeleton de tipos. Este slot adiciona React 19 + Tailwind 4 + utilidades (`cn`, variants), configura Ladle e entrega Button, Input, Card, Modal, Toast — os tijolos de toda tela (login, shell, features).

## Escopo (faz)

- Infra do pacote: `package.json` (react 19, react-dom, tailwindcss 4, clsx, tailwind-merge, lucide-react, motion; devDep @ladle/react, @types/react), `tsconfig.json` (jsx react-jsx, lib dom), `.ladle/config.mjs` + provider que importa `@hm/design-tokens/tokens.css` e permite alternar `data-theme`.
- `src/lib/cn.ts` (clsx + tailwind-merge) e `src/lib/variants.ts` (helper tipado de variantes — estilo cva, sem dep nova se simples).
- **Button** (`src/Button/`): variantes `primary|secondary|ghost|danger|outline|link`, sizes `sm|md|lg`, estados default/hover/active(`scale .98`)/focus(anel `--glow-md`)/loading(spinner inline, click bloqueado)/disabled (§4.1).
- **Input** (`src/Input/`): `label`, `hint`, `error`, sizes; estados focus(`--brand`+`--glow-sm`)/error(`--danger`)/disabled; `aria-invalid` + `aria-describedby` (§4.2, §8.2).
- **Card** (`src/Card/`): `Card`/`CardHeader`(title+action)/`CardBody`, elevations 1–4 (§4.3).
- **Modal** (`src/Modal/`): portal + backdrop + focus trap + Esc/click-out fecha; `role="dialog"`, `aria-modal`, `aria-labelledby/describedby` (§4.4, §8.2). Reservado a confirmação/wizard (UX §2.3).
- **Toast** (`src/Toast/`): **único** ToastProvider + `useToast()`; variantes success/error/warn/info com ícone Lucide; posições top-right (default)/bottom (§4.6). NUNCA duplicar (lição v1).
- `src/index.ts` — barrel exportando os 5 + tipos de variante.
- Stories `.stories.tsx` por componente cobrindo todos os estados (§12).

## Fora de escopo

- Primitives estendidos (Badge, Avatar, Skeleton, Tabs, Tooltip, Drawer/Sheet, etc. — §4.10): cada feature traz o seu quando precisar.
- EmptyState/ErrorState/HelpPanel/CommandPalette — são composições de app (F0-S12).
- Consumo no `apps/web` (F0-S11/S13).

## Arquivos permitidos

- `packages/ui/**`

## Arquivos proibidos

- `packages/design-tokens/**`, `apps/web/**`.

## Contratos de saída

- `import { Button, Input, Card, CardHeader, CardBody, Modal, ToastProvider, useToast } from '@hm/ui'`.
- Tipos `Variant`, `Size` reexportados (já existem no skeleton — manter/estender).

## Definition of Done

- [ ] 5 primitives implementados com **todos** os estados (default/hover/active/focus/loading/disabled onde aplicável).
- [ ] Focus ring visível (`--glow-md`) em todo interativo (§8.1).
- [ ] Funciona em `data-theme="dark"` e `light` (toggle no Ladle).
- [ ] `prefers-reduced-motion` respeitado em animações decorativas (Modal/Toast in); spinners permanecem.
- [ ] Zero hex hardcoded — só classes Tailwind mapeadas a tokens.
- [ ] Cada componente tem story em Ladle cobrindo estados.
- [ ] Toast é único (um provider, um componente).
- [ ] `pnpm --filter @hm/ui ladle:build` ok; `pnpm typecheck` e `pnpm lint` limpos.

## UX considerations

- Aplica UX §2.7 (click-fantasma): Button `loading` + disabled durante ação assíncrona; cursor coerente.
- Aplica UX §2.3 (modal-cobre-tudo): Modal é só p/ confirmação/wizard — documentar isso na story; detalhe de item usa Drawer (vem por feature).
- Aplica UX §3.6 (skeleton) indiretamente: provê base; Skeleton-pattern fica em F0-S12.
- Aplica UX §3.10 / DS §7 (animação curta < 250ms, intencional, Motion One).
- Aplica DS §8.2 (ARIA em Modal/Input).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/ui ladle:build
```

## Notas

- `variants.ts`: se a complexidade justificar, usar `class-variance-authority`; senão helper próprio tipado.
- Ícones: Lucide `currentColor` (§6). Tamanhos 16/20/24/32.
