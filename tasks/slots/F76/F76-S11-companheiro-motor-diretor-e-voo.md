---
id: F76-S11
title: Companheiro das telas de acesso — motor (máquina de estados, diretor de foco, voo WAAPI, balão)
phase: F76
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F76-S10]
blocks: [F76-S13]
source_docs:
  - docs/design/auth-companion/SPEC.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
agent_id: frontend-engineer
---
# F76-S11 — Motor do companheiro

## Objetivo

Implementar, com plano fechado pela SPEC do S10, o motor que dá vida à arte: máquina de estados pura, diretor que
traduz foco e sinais dos formulários em posto/estado/olhar/balão, gerador de keyframes de voo (arco, mola, esmagar e
esticar) e o palco que não afeta layout nem LCP.

## Escopo (faz)

Tudo em `apps/web/features/auth/companion/` (exceto `contract.ts`, `copy.ts`, `art/**`):

- `machine.ts`: puro, sem DOM; fila de 1; `thinking` interrompe; estados com fim voltam a `idle`.
- `director.ts`: escuta **só** `focusin`/`focusout` na raiz; lê apenas `target.type`, `getBoundingClientRect()` e se o
  alvo é editável. **Nunca** lê `.value`, nunca escuta `input`/`keydown.key`. Mantém um único `lastKeyAt` (horário,
  sem a tecla) só para pausar a respiração. `focusin` em `type=password` ⇒ `avert`.
- `flight.ts`: keyframes WAAPI com a curva e as durações da SPEC; `d = clamp(560, 420 + dist·0,45, 760)` ms.
- `anchors.tsx`: `useCompanionAnchor`, `CompanionPerch`, `CompanionInlineSlot`; medição em coordenadas do documento;
  recalcula em `ResizeObserver`, `document.fonts.ready` e troca de etapa.
- `AuthCompanionRoot.tsx` (provider + palco `absolute inset-0 pointer-events-none aria-hidden`; a figura entra por
  `next/dynamic` com `ssr:false`, após idle e ≥ 400 ms depois do FCP), `CompanionFigure.tsx` (`data-state`,
  `data-look`), `Bubble.tsx`, `companion.css` (só no chunk lazy; só `transform`/`opacity`; `will-change` só no voo).
- Pausa com `IntersectionObserver` + `visibilitychange`; teclado virtual aberto (`visualViewport`) esconde o balão e
  congela a respiração; `data-brand` diferente de `leadium` ⇒ não renderiza.
- `COMPANION_CHUNK_MARKER` dentro do chunk lazy (para o teste de peso do S13).
- Testes: máquina (fila, interrupção, retorno a `idle`); diretor com **Proxy que lança ao acessar `.value`**;
  reduced-motion (sem voo, crossfade de 160 ms); pausa; marca.

## Fora de escopo

- Arte, contrato e copy (S10); integração (S12).

### files_allowed

- `apps/web/features/auth/companion/machine.ts`
- `apps/web/features/auth/companion/director.ts`
- `apps/web/features/auth/companion/flight.ts`
- `apps/web/features/auth/companion/anchors.tsx`
- `apps/web/features/auth/companion/AuthCompanionRoot.tsx`
- `apps/web/features/auth/companion/CompanionFigure.tsx`
- `apps/web/features/auth/companion/Bubble.tsx`
- `apps/web/features/auth/companion/companion.css`
- `apps/web/features/auth/companion/*.test.ts`
- `apps/web/features/auth/companion/*.test.tsx`

### files_forbidden

- `apps/web/features/auth/companion/contract.ts`
- `apps/web/features/auth/companion/copy.ts`
- `apps/web/features/auth/companion/art/**`
- `apps/web/app/**`

## Definition of Done

- [ ] teste do Proxy prova que o diretor nunca acessa `.value`
- [ ] nenhum `keydown`, `fetch`, `sendBeacon` nem hex em `features/auth/companion/**` (busca)
- [ ] zero animações rodando com aba oculta ou fora da viewport (teste)
- [ ] só `transform`/`opacity` no personagem; sem rAF contínuo
- [ ] zero `any`

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run --maxWorkers=1 features/auth/companion
```

## Notas

- Agente: `frontend-engineer` (Sonnet, plano fechado). Roda em worktree próprio, em paralelo ao S12.
