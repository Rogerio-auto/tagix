---
id: F72-S09
title: Auditoria final do DS 3.0 — acessibilidade nos dois temas, peso, capturas e revisão de gosto
phase: F72
status: blocked
priority: high
estimated_size: M
ui: true
depends_on: [F72-S04, F72-S05, F72-S06, F72-S07, F72-S08]
blocks: []
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/DESIGN_SYSTEM_V3_DELTA.md
---
# F72-S09 — Auditoria final do DS 3.0

## Objetivo

Provar que o produto inteiro está no DS 3.0 com qualidade de entrega: AA nos dois temas, peso dentro do orçamento, movimento com propósito e nada com cara de template.

## Escopo (faz)

- axe em todas as rotas de `apps/web/app/**`, nos temas dark e light, a 375 e 1440, com relatório em `docs/a11y/`.
- Contraste medido dos pares críticos (texto-low, brand-text, status) em tela real.
- Peso: First Load JS por rota e bytes de fonte; Lighthouse mobile em Home, Inbox e Login. Comparar com o antes da F72 e com o teto do cânone.
- `prefers-reduced-motion`: nenhum movimento contínuo fora de estado vivo.
- Varredura de resto v2: grep por Rajdhani, Orbitron, Chakra, hex literal e `font-display` sem uso. O lint hex/locale/fuso vira `error` se a dívida chegou a zero; senão, registrar o número.
- Revisão `/hm-designer` do produto inteiro contra a maquete, com correções pequenas aplicadas e as maiores viradas slot.
- e2e da suíte inteira verde contra build de produção.

### files_allowed

- `docs/a11y/**`, `docs/performance/**`, `docs/features/DS3_ADOCAO.md`
- `apps/web/e2e/**`
- `eslint.config.*` (promover regra para `error`)
- correções pontuais em qualquer arquivo de UI, com nota de correção no slot

## Definition of Done

- [ ] relatório de a11y: zero violação séria ou crítica
- [ ] relatório de peso com antes e depois
- [ ] nenhum resto de fonte v2 no bundle
- [ ] veredito `/hm-designer` registrado, com as ressalvas abertas viradas slot

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Agentes: `qa-engineer` + revisor no papel de `/hm-designer`.
