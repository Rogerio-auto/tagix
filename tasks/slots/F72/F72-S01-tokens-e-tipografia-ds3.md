---
id: F72-S01
title: Tokens, fontes e escala tipográfica do DS 3.0, com tema claro corrigido
phase: F72
status: in-progress
priority: critical
estimated_size: M
ui: true
depends_on: []
blocks: [F72-S02, F72-S03]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/decisions/ADR-002-tipografia-ds3.md
  - docs/DESIGN_SYSTEM_V3_DELTA.md
  - docs/design/ds-3.0-agency-os.html
agent_id: backend-engineer
claimed_at: 2026-10-07T18:30:43Z

---
# F72-S01 — Tokens, fontes e escala tipográfica do DS 3.0

## Objetivo

`@hm/design-tokens` passa a carregar os valores do DS 3.0 (paleta, raios, sombras, glow, tipografia), com os dois temas completos e o claro corrigido para AA, **sem renomear nenhum token existente**. O app carrega Space Grotesk, Manrope e IBM Plex Mono via `next/font`, e o Orbitron sai.

## Escopo (faz)

- `tokens.css`:
  - valores do DS 3.0 nos nomes semânticos do v2 (mapa em `DS3_ADOCAO.md` §3; conferir os nomes reais no arquivo);
  - tokens novos: `--bg-elevated`, `--surface-glass`, `--violet`, `--brand-text`, `--shadow-1..3`, `--glow`, `--r-xl`, `--font-mono`;
  - `--font-price` vira alias de `--font-mono` e `--font-display` vira alias de `--font-head`;
  - tema claro completo, com `--text-low ≈ #5F6A5E`, `--brand-text` e tons de status do claro, todos ≥4,5:1. Os pares (texto × fundo, nos dois temas) ficam medidos numa tabela nas Notas de execução.
- `typography.ts` + `@theme` (em sincronia):
  - heads em Space Grotesk com o tracking do ADR;
  - `body` 16px/500/1.65;
  - `price` em mono com `tabular-nums`;
  - `display` passa a usar a família de head, sem caixa-alta forçada (a menos que a maquete use).
- `fonts.ts` e `apps/web/app/layout.tsx`: `next/font` com Space Grotesk (500, 600, 700), Manrope (400 a 700) e IBM Plex Mono (400, 500, 600), `display: swap`, só o subset latin. Sai o Orbitron, a Rajdhani e a Chakra Petch.
- `tailwind-preset.ts` expõe os tokens novos (cores, sombras, `rounded-xl`, `font-mono`).
- Docs:
  - `DESIGN_SYSTEM.md`: seção v3 com os tokens, a tipografia e o §14 apontando para o ADR-002;
  - `APP_MOBILE_PLAN.md` §3.1 com 4 abas + Mais;
  - `INDEX.md` com o link para a F72.
- Teste de contraste automatizado: lê os pares do `tokens.css` dos dois temas e falha abaixo de 4,5:1 (texto) ou 3:1 (UI).

## Fora de escopo

- Componentes (S02), shell (S03) e telas (S04–S08).

### files_allowed

- `packages/design-tokens/**`
- `apps/web/app/layout.tsx`, `apps/web/app/globals.css`
- `docs/DESIGN_SYSTEM.md`, `docs/features/APP_MOBILE_PLAN.md`, `docs/INDEX.md`, `docs/features/DS3_ADOCAO.md`

## Definition of Done

- [ ] nenhum token existente renomeado ou removido (diff dos nomes no slot)
- [ ] teste de contraste dos dois temas verde
- [ ] build do web verde; First Load JS não cresce por fonte. Medir os bytes de fonte antes e depois: 3 famílias contra 4
- [ ] capturas de 3 telas (Home, inbox, login) antes/depois em 1440 dark e light, só para mostrar a repintura
- [ ] docs atualizados

## Validação

```bash
pnpm --filter @hm/design-tokens typecheck
pnpm --filter @hm/design-tokens test
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web build
```

## Notas

- Agente: `frontend-engineer`.
- Não colar o `:root` da maquete (`DESIGN_SYSTEM_V3_DELTA` §3.1).
