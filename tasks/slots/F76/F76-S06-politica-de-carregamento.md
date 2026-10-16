---
id: F76-S06
title: Política de carregamento — loading.tsx por rota com skeleton imediato e LongWait só em espera longa
phase: F76
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F76-S03]
blocks: [F76-S09]
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
  - docs/UX_PRINCIPLES.md
agent_id: frontend-engineer
---
# F76-S06 — Política de carregamento

## Objetivo

Toda rota do app autenticado mostra em 0 ms um esqueleto fiel ao layout; o personagem só aparece quando a espera
passa de 1,2 s (e fica ≥ 600 ms), em rotas e ações onde ele ajuda; Inbox, números e toasts nunca o recebem.

## Contexto

Spec §7 (tabela "onde o personagem entra") e ADR-006 §5. Hoje só existem `apps/web/app/(app)/loading.tsx`,
`calendar/loading.tsx` e `flows/[id]/loading.tsx`; skeletons em `packages/ui/src/Skeleton` e
`apps/web/shared/components/feedback/{Skeleton,WidgetSkeleton}.tsx`.

## Escopo (faz)

- `apps/web/shared/components/loading/`: skeletons de rota reutilizáveis (`RouteSkeleton` com variantes `list`,
  `board`, `calendar`, `detail`, `editor`, `settings`), compostos dos skeletons existentes; e `RouteLongWait`
  (cliente) que envolve o skeleton num `LongWait` com rótulo por rota.
- `loading.tsx` por rota (skeleton fiel + política):
  - com `LongWait`: `(app)/loading.tsx` (primeira carga), `pipeline`, `calendar` (existente, adaptar),
    `flows/[id]` (existente, adaptar), `campaigns`, `agents`, `knowledge`, `conversions`, `contacts`, `hoje`;
  - **só skeleton, sem personagem**: `conversations` (Inbox), `settings`, `help`.
- Fallbacks de `Suspense` dos widgets da Home e do dashboard: confirmar que são skeleton puro (nunca personagem em
  KPI/número); ajustar só se algum usar spinner genérico.
- Ações em lote existentes com progresso real: importação de destinatários de campanha
  (`apps/web/features/campaigns/editor/audience/AudienceStep.tsx`) passa a usar `LongWait` com `progress` quando
  passar de 1,2 s.
- `useLongWait` aplicado às mutations demoradas já existentes que hoje mostram spinner sem prazo (listar as
  encontradas nas notas; aplicar nas que estiverem nos arquivos permitidos).
- Teste e2e `apps/web/e2e/specs/loading-policy.spec.ts`: com a rede atrasada por rota (Playwright `route` com
  atraso), 800 ms ⇒ só skeleton; 2 s ⇒ personagem visível e ≥ 600 ms; Inbox com 3 s ⇒ nunca personagem; marca
  `glyph` (cookie/flag de teste) ⇒ nunca personagem.

## Fora de escopo

- Rotas da F75 (`/integracoes`, têm `loading.tsx` próprio no F75-S09) e da F74 (`/copiloto`).

### files_allowed

- `apps/web/shared/components/loading/**`
- `apps/web/app/(app)/loading.tsx`
- `apps/web/app/(app)/pipeline/loading.tsx`
- `apps/web/app/(app)/calendar/loading.tsx`
- `apps/web/app/(app)/flows/[id]/loading.tsx`
- `apps/web/app/(app)/campaigns/loading.tsx`
- `apps/web/app/(app)/agents/loading.tsx`
- `apps/web/app/(app)/knowledge/loading.tsx`
- `apps/web/app/(app)/conversions/loading.tsx`
- `apps/web/app/(app)/contacts/loading.tsx`
- `apps/web/app/(app)/hoje/loading.tsx`
- `apps/web/app/(app)/conversations/loading.tsx`
- `apps/web/app/(app)/settings/loading.tsx`
- `apps/web/app/(app)/help/loading.tsx`
- `apps/web/features/campaigns/editor/audience/AudienceStep.tsx`
- `apps/web/e2e/specs/loading-policy.spec.ts`

## Definition of Done

- [ ] cada rota da lista tem `loading.tsx` com skeleton fiel (captura lado a lado skeleton × página carregada)
- [ ] e2e da política verde (800 ms, 2 s, Inbox, marca glyph)
- [ ] nenhum `loading.tsx` importa o personagem diretamente (só via `RouteLongWait`) — grep
- [ ] CLS 0 entre skeleton e conteúdo nas rotas principais (medir 3: pipeline, contacts, campaigns)
- [ ] axe sem violação séria nos skeletons; capturas 375/1440 × 2 temas em `apps/web/e2e/.artifacts/f76-s06/`

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm exec eslint apps/web/shared/components/loading "apps/web/app/(app)"
pnpm --filter @hm/web exec vitest run shared/components/loading --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`. Skeleton é a primeira coisa: o personagem nunca entra antes de 1,2 s e nunca no
  lugar do esqueleto, entra **sobre** ele (centralizado no conteúdo, com o rótulo).
