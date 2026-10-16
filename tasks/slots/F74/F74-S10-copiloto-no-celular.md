---
id: F74-S10
title: Copiloto no celular (gesto da borda, folha a 78%, tela cheia para ação com botões no polegar, áreas seguras) (A12)
phase: F74
status: blocked
priority: high
estimated_size: M
model: opus
ui: true
depends_on: [F74-S02, F74-S03, F74-S04, F74-S05]
blocks: [F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
  - docs/MOBILE_UX.md
  - docs/features/APP_MOBILE_PLAN.md
agent_id: frontend-engineer
---
# F74-S10 — Celular (375)

## Objetivo

No celular, o gesto é deslizar da borda direita e o Copiloto vira uma **folha que sobe de baixo a 78%** da altura, com a mesma conversa. Puxar a alça cinza para cima leva à tela cheia; para baixo, fecha. Um cartão de ação com impacto sobe sozinho para tela cheia, esconde o compositor e mantém Confirmar fixo no alcance do polegar, acima da área segura. A BottomNav de 4 abas sai de cena até concluir (A12).

## Contexto

A PWA (F61) e a navegação de 4 abas (F72-S03) existem. O `Sheet` mobile (`shared/components/Sheet`) é a base de comportamento. O botão no TopBar do celular é da F76 e abre por `useCopilot().open()`.

## Escopo (faz)

- `apps/web/features/copilot/mobile/**`:
  - `MobileSheet.tsx`: superfície `sheet` quando a viewport é ≤ 767 px. `CopilotRoot` (S02) já escolhe pelo `size`; aqui o S10 entrega o componente, e o `CopilotRoot` o carrega por `next/dynamic` a partir de `mobile/index.ts`. Este slot cria o arquivo; o import no `CopilotRoot` é a única linha fora da pasta, ver files_allowed.
    - Altura de 78% (`dvh`), alça cinza de arraste (o mesmo gesto do `Sheet` existente, reusando o hook, sem copiar), puxar para cima = tela cheia, para baixo = fecha.
    - Respeita `env(safe-area-inset-*)`. Teclado virtual não cobre o compositor (`visualViewport`).
    - Campo de 16 px, alvos ≥ 44 px.
  - `EdgeSwipe.tsx`: deslizar da borda direita (zona de 16 px, |dx| > |dy|) abre a folha; não conflita com o voltar do iOS (borda esquerda) nem com a rolagem; primeira vez: a dica aparece por 3 s.
  - `ActionFullscreen.tsx`: quando chega um `action_proposed` de nível 3 ou 4, o cartão (S04) sobe para tela cheia sobre tudo (inclusive a BottomNav, por camada e não por edição da nav). Compositor escondido; Confirmar, Ajustar e Cancelar fixos no rodapé acima da área segura; ao concluir ou cancelar, volta para a folha.
  - Briefing no celular: não abre sozinho (S05); o selo de pendência vai para `pending` (F76 exibe).
- `apps/web/features/copilot/surfaces/CopilotRoot.tsx`: só a linha do `next/dynamic` que carrega `mobile/`.
- `apps/web/e2e/specs/copilot-mobile.spec.ts` (viewport 375 × 812, `hasTouch`): deslizar da borda abre; folha a 78%; puxar para cima → tela cheia; para baixo → fecha; ação de nível 3 sobe para tela cheia com Confirmar visível acima do inset; teclado (`visualViewport` simulado) não cobre o compositor.

### files_allowed

- `apps/web/features/copilot/mobile/**`
- `apps/web/features/copilot/surfaces/CopilotRoot.tsx`
- `apps/web/e2e/specs/copilot-mobile.spec.ts`

### files_forbidden

- `apps/web/shared/components/layout/BottomNav.tsx`
- `apps/web/shared/components/Sheet/**` (só importar)

## Definition of Done

- [ ] Fiel à A12 nos dois temas; capturas 375 dos 3 estados (alça e dica, folha, ação em tela cheia) em `apps/web/e2e/.artifacts/f74-s10/`
- [ ] Gesto sem conflito com rolagem nem com o voltar do sistema (e2e com lista rolável atrás)
- [ ] Alvos ≥ 44 px e campo de 16 px (teste mede); áreas seguras respeitadas (screenshot com inset simulado)
- [ ] Reduced motion: a folha esmaece em vez de subir com mola
- [ ] axe sem violação séria; `/hm-designer` contra A12

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/mobile --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/mobile --max-warnings=0
```

## Notas

- Agente: `frontend-engineer` (opus: gesto e polegar decidem a experiência).
- Testar num iPhone real via PWA instalada, se houver aparelho; registre na nota o modelo e o iOS.
