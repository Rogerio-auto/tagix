# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NAO edite a mao — slot frontmatters sao a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 16     | 0   | 0   | 0   | 0   | 0   | 16   |
| F1   | 23     | 0   | 8   | 0   | 0   | 0   | 15   |

## Fase 0 — Fundação

| ID     | Titulo                                                                                          | Status | Prioridade | Depende de     |
| ------ | ----------------------------------------------------------------------------------------------- | ------ | ---------- | -------------- |
| F0-S01 | Monorepo pnpm + tsconfig base + lint + skeletons de packages/apps                               | ✅ done | high       | —              |
| F0-S02 | Docker Compose dev — Postgres pgvector + Redis + RabbitMQ + WAHA                                | ✅ done | high       | F0-S01         |
| F0-S03 | Schema Drizzle base + migrations + seed (workspaces, members, plans, subscriptions, audit_logs) | ✅ done | critical   | F0-S01         |
| F0-S04 | RLS policies multi-tenant + teste de isolamento                                                 | ✅ done | critical   | F0-S03         |
| F0-S05 | Auth — IAuthProvider + Supabase adapter + login/logout API + cookie de sessão                   | ✅ done | critical   | F0-S03         |
| F0-S06 | Express 5 server + middlewares + matriz de permissões can() em @hm/shared                       | ✅ done | critical   | F0-S03, F0-S05 |
| F0-S07 | Socket.io + Redis adapter + rooms por workspace/member                                          | ✅ done | high       | F0-S06         |
| F0-S08 | Logger Pino + OpenTelemetry + PII masking em @hm/logger                                         | ✅ done | high       | F0-S01         |
| F0-S09 | Design tokens — CSS vars + Tailwind preset + tipografia + fontes                                | ✅ done | critical   | F0-S01         |
| F0-S10 | "@hm/ui base — infra + Ladle + 5 primitives (Button, Input, Card, Modal, Toast)"                | ✅ done | critical   | F0-S09         |
| F0-S11 | apps/web shell — Next 15 App Router + providers + theme-no-flash + AppLayout                    | ✅ done | high       | F0-S10         |
| F0-S12 | Infra de UX — EmptyState, ErrorState, HelpPanel, CommandPalette, atalhos, density               | ✅ done | high       | F0-S11         |
| F0-S13 | Login + ResetPassword (DS v2, RHF + Zod) — primeira tela ponta-a-ponta                          | ✅ done | high       | F0-S11, F0-S12 |
| F0-S14 | RabbitMQ topology + helper publish/consume + envelope schema                                    | ✅ done | high       | F0-S08         |
| F0-S15 | Storage — LocalDriver (dev) + R2Driver (S3) + signed URL                                        | ✅ done | medium     | F0-S01         |
| F0-S16 | CI GitHub Actions — lint + typecheck + build + test (+ deploy SSH inerte)                       | ✅ done | medium     | F0-S01         |

## Fase 1 — Channels & LiveChat core

| ID     | Titulo                                                                        | Status     | Prioridade | Depende de             |
| ------ | ----------------------------------------------------------------------------- | ---------- | ---------- | ---------------------- |
| F1-S01 | Schema channels + channel_secrets + crypto AES-256-GCM (+ colunas IG)         | ✅ done     | critical   | F0-S03, F0-S04         |
| F1-S02 | Webhook Meta unificado + signature verify + dedup (webhook_events)            | ✅ done     | critical   | F0-S06, F1-S01         |
| F1-S03 | Schema platform_secrets + carregamento boot-time                              | ✅ done     | high       | F0-S03                 |
| F1-S04 | Worker inbound — parser por provider + persist + relay                        | ✅ done     | critical   | F1-S02, F1-S05, F1-S09 |
| F1-S05 | Schema contacts + conversations + messages + repos + interactive types        | ✅ done     | critical   | F1-S01                 |
| F1-S06 | Schema ig_comments (auxiliar Instagram)                                       | ✅ done     | low        | F1-S05                 |
| F1-S07 | Worker outbound — composition + per-chat lock + provider routing              | ✅ done     | critical   | F1-S05, F1-S08, F1-S09 |
| F1-S08 | MetaWhatsAppAdapter completo (sendText/Media/Template/Interactive + parser)   | ✅ done     | critical   | F1-S09                 |
| F1-S09 | IChannelAdapter + capabilities + graphClient + MetaInstagramAdapter STUB      | ✅ done     | critical   | F1-S01                 |
| F1-S10 | Worker media — download Meta + dedup SHA-256 + upload R2 + signed URL         | ⏸️ blocked | high       | F1-S04, F1-S08, F0-S15 |
| F1-S11 | Socket relay — hm.q.socket.relay → io.emit + socket-events tipados            | ✅ done     | high       | F0-S07, F1-S05         |
| F1-S12 | API GET /conversations + /conversations/:id/messages + cache versioning       | ✅ done     | critical   | F1-S05, F0-S06         |
| F1-S13 | Frontend ConversationsPage — layout 3 colunas + ContactInfoPanel skeleton     | ✅ done     | high       | F0-S11, F0-S12, F1-S12 |
| F1-S14 | ChatList — real-time + filtros (incl. provider) + search + scroll infinito    | ✅ done     | high       | F1-S13, F1-S11, F1-S12 |
| F1-S15 | MessageBubble — discriminated union (text/image/.../interactive); IG em stubs | ⏸️ blocked | high       | F1-S13, F1-S05, F1-S10 |
| F1-S16 | MessageComposer — textarea + media upload + emoji + mention @ + reply         | ✅ done     | high       | F1-S13, F1-S12         |
| F1-S17 | Janela 24h Meta no composer + CTA template (WA) + state machine IG-ready      | ⏸️ blocked | high       | F1-S16, F1-S07         |
| F1-S18 | WAHAAdapter (inbound + outbound) + session management                         | ✅ done     | high       | F1-S09                 |
| F1-S19 | Channel settings page + connect wizard (Meta FB Login + WAHA)                 | ⏸️ blocked | high       | F1-S01, F1-S03, F0-S11 |
| F1-S20 | Read receipts e delivery status (status callbacks Meta WA)                    | ⏸️ blocked | medium     | F1-S07, F1-S11, F1-S15 |
| F1-S21 | Typing/recording presence (pre_action)                                        | ⏸️ blocked | low        | F1-S07, F1-S11         |
| F1-S22 | Notas internas com mentions (conversation_notes + auto-notification)          | ⏸️ blocked | medium     | F1-S05, F1-S12         |
| F1-S23 | Auto-assign + manual transfer + routing_history                               | ⏸️ blocked | medium     | F1-S05, F1-S12         |
