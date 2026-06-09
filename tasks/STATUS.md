# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NAO edite a mao — slot frontmatters sao a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 6     | 0   | 4   | 0   | 0   | 0   | 2   |

## Fase 0 — Fundação

| ID     | Titulo                                                                            | Status     | Prioridade | Depende de     |
| ------ | --------------------------------------------------------------------------------- | ---------- | ---------- | -------------- |
| F0-S01 | Monorepo pnpm + tsconfig base + lint + skeletons de packages/apps                 | ✅ done     | high       | —              |
| F0-S09 | Design tokens — CSS vars + Tailwind preset + tipografia + fontes                  | ✅ done     | critical   | F0-S01         |
| F0-S10 | "@hm/ui base — infra + Ladle + 5 primitives (Button, Input, Card, Modal, Toast)"  | ⏸️ blocked | critical   | F0-S09         |
| F0-S11 | apps/web shell — Next 15 App Router + providers + theme-no-flash + AppLayout      | ⏸️ blocked | high       | F0-S10         |
| F0-S12 | Infra de UX — EmptyState, ErrorState, HelpPanel, CommandPalette, atalhos, density | ⏸️ blocked | high       | F0-S11         |
| F0-S13 | Login + ResetPassword (DS v2, RHF + Zod) — primeira tela ponta-a-ponta            | ⏸️ blocked | high       | F0-S11, F0-S12 |
