# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NAO edite a mao — slot frontmatters sao a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 16     | 3   | 3   | 0   | 0   | 1   | 9   |

## Fase 0 — Fundação

| ID     | Titulo                                                                                          | Status      | Prioridade | Depende de     |
| ------ | ----------------------------------------------------------------------------------------------- | ----------- | ---------- | -------------- |
| F0-S01 | Monorepo pnpm + tsconfig base + lint + skeletons de packages/apps                               | ✅ done      | high       | —              |
| F0-S02 | Docker Compose dev — Postgres pgvector + Redis + RabbitMQ + WAHA                                | ✅ done      | high       | F0-S01         |
| F0-S03 | Schema Drizzle base + migrations + seed (workspaces, members, plans, subscriptions, audit_logs) | ✅ done      | critical   | F0-S01         |
| F0-S04 | RLS policies multi-tenant + teste de isolamento                                                 | ✅ done      | critical   | F0-S03         |
| F0-S05 | Auth — IAuthProvider + Supabase adapter + login/logout API + cookie de sessão                   | 🟣 review    | critical   | F0-S03         |
| F0-S06 | Express 5 server + middlewares + matriz de permissões can() em @hm/shared                       | ⏸️ blocked  | critical   | F0-S03, F0-S05 |
| F0-S07 | Socket.io + Redis adapter + rooms por workspace/member                                          | ⏸️ blocked  | high       | F0-S06         |
| F0-S08 | Logger Pino + OpenTelemetry + PII masking em @hm/logger                                         | 🟢 available | high       | F0-S01         |
| F0-S09 | Design tokens — CSS vars + Tailwind preset + tipografia + fontes                                | ✅ done      | critical   | F0-S01         |
| F0-S10 | "@hm/ui base — infra + Ladle + 5 primitives (Button, Input, Card, Modal, Toast)"                | ✅ done      | critical   | F0-S09         |
| F0-S11 | apps/web shell — Next 15 App Router + providers + theme-no-flash + AppLayout                    | ✅ done      | high       | F0-S10         |
| F0-S12 | Infra de UX — EmptyState, ErrorState, HelpPanel, CommandPalette, atalhos, density               | ✅ done      | high       | F0-S11         |
| F0-S13 | Login + ResetPassword (DS v2, RHF + Zod) — primeira tela ponta-a-ponta                          | ✅ done      | high       | F0-S11, F0-S12 |
| F0-S14 | RabbitMQ topology + helper publish/consume + envelope schema                                    | ⏸️ blocked  | high       | F0-S08         |
| F0-S15 | Storage — LocalDriver (dev) + R2Driver (S3) + signed URL                                        | 🟢 available | medium     | F0-S01         |
| F0-S16 | CI GitHub Actions — lint + typecheck + build + test (+ deploy SSH inerte)                       | 🟢 available | medium     | F0-S01         |
