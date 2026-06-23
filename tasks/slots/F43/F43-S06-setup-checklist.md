---
id: F43-S06
title: Checklist "Primeiros passos" no dashboard (estado derivado)
phase: F43
status: done
priority: medium
estimated_size: S
depends_on: [F43-S04]
blocks: [F43-S08]
agent_id: frontend-engineer
source_docs:
  - docs/features/ONBOARDING.md
  - docs/features/DASHBOARD.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.6 — checklist é o anti-empty-state do dashboard novo: mostra o próximo passo com CTA."
  - "Aplica 2.4 — cada item linka direto para a tela (path óbvio), não menu escondido."
  - "Aplica 2.7 — itens refletem dado real (sem click-fantasma); some quando completo/dispensado."
claimed_at: 2026-06-19T22:21:41Z
completed_at: 2026-06-19T22:28:11Z

---
# F43-S06 — Checklist "Primeiros passos"

> **source_docs:** `docs/features/ONBOARDING.md` §3.3; `docs/features/DASHBOARD.md`
> **depends_on:** F43-S04 (`GET /api/onboarding/checklist`)
> **blocks:** F43-S08 (compartilha `DashboardClient.tsx` — sequenciado)

## Objetivo

Widget de "Primeiros passos" no topo do dashboard que guia o setup inicial, com estado
**derivado do dado real** e link para cada tela.

## Escopo (faz)

- Componente de checklist em `apps/web/features/onboarding/checklist/**` consumindo
  `GET /api/onboarding/checklist`.
- Montar no `DashboardClient` (acima dos cards), visível enquanto houver passos pendentes;
  dispensável (persiste via estado de onboarding) e some quando completo.
- Itens: conectar WhatsApp, ativar agente, importar contatos, publicar 1º flow, enviar 1ª campanha —
  cada um com CTA linkando para a tela.

## Fora de escopo

- Lógica de derivação (vem do backend S04). Tour (S07/S08). Ajuste de grid dos cards.

## Arquivos permitidos

- `apps/web/features/onboarding/checklist/**`
- `apps/web/features/dashboard/DashboardClient.tsx`

## Arquivos proibidos

- `apps/web/app/(app)/layout.tsx` (F43-S05)
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Checklist reflete dado real; cada item linka para a tela certa.
- [ ] Some quando todos os passos completos ou ao dispensar (persistido).
- [ ] Loading/empty states; DS v2 (zero hex).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Compartilha `DashboardClient.tsx` com F43-S08 → sequenciado por dependência.
