
## F6 wave 1 — dispatch (orchestrator)
- F6-S01 [db] schema campaigns (7 tabelas + scheduled_followups + idempotency UNIQUE + RLS) → db-engineer
- F6-S02 [channels] meta errors map + quality/template helpers → backend-engineer
- Paralelos: pacotes disjuntos (@hm/db vs @hm/channels), zero overlap em files_allowed.
- Integração 1-por-vez via stash dance; S01 antes (S02 não depende de S01 mas S03/S05 dependem de ambos).

## F7 wave 1 — dispatch (orchestrator) 2026-06-11
- F7-S01 [db] schema calendar (5 tabelas: calendars/availability_rules/availability_exceptions/events/event_participants) + funcao PL/pgSQL `compute_available_slots` (DATA_MODEL §12.6 / CALENDAR.md §3.1, com buffer/min_notice/timezone) + RLS → db-engineer.
- Gate de toda a F7 (S02..S07 dependem dele direta ou transitivamente). Despachado SOLO (sem paralelo).
- Branch canonica: feat/f7-s01 (claim ja feito pelo orchestrator).
- event_participants NAO tem workspace_id proprio → RLS via subquery em events (espelha agent_tools/campaign_steps).
- Migration: drizzle-kit generate p/ as 5 tabelas (0030) + migration custom SQL (0031) com a funcao + RLS. Validar contra Postgres real (member com rules + 1 excecao + 1 evento conflitante → 3 filtros).

## F15 (Instagram channel completion) — dispatch (orchestrator) 2026-06-12
Grafo: S01 ─┬ S02 ─ S03 ─┐; ├ S04 ┴ S05 ─ S08; └ S06 ─ S07. S09 (docs) ∥ desde o início.
- **Wave 1**: F15-S01 (IG adapter completo, channels, critical) + F15-S09 (docs App Review/opt-out/redact, general-purpose). Disjuntos (packages/channels vs docs/runbooks).
- DECISÃO de fronteira: o canonical `OutboundJob` discriminated union vive em `apps/workers/src/outbound/job.ts` (Zod), NÃO em `packages/channels/src/types.ts`. S01 NÃO toca o worker. S01 adiciona ao `IChannelAdapter` as assinaturas de comment actions (sendPrivateReplyToComment/replyPublicToComment/hideComment/deleteComment) + input types IG no `types.ts`. A extensão da union `OutboundJob` (kinds ig_private_reply/ig_public_reply/ig_hide_comment) é de F15-S04 (owns apps/workers/src/outbound/**). Evita colisão cross-slot.
- Workers NÃO rodam git/slot.py/commit/pnpm install/pnpm build. Integração e wire são do orchestrator (stash-dance 1-a-1 ao fechar a onda).

## F15 wave 2 — dispatch (orchestrator) 2026-06-12
S01 done → desbloqueia S02, S04, S06 (paralelos, paths disjuntos: api/webhooks vs workers/outbound vs api/channels).
- F15-S02: webhook IG. ACHADO: meta.ts JÁ roteia object:'instagram' (providerForObject) + dedup provider-aware + publishInboundMessage compartilhado + deriveEventId já cobre mid/comment id. event-id.ts/dedup.ts/signature.ts são PROIBIDOS no slot. → S02 isola o parsing/roteamento IG num módulo dedicado `meta-instagram.ts` (extractIgEventSummaries) + teste de ingestão IG; meta.ts segue magro (já montado, sem wire novo).
- F15-S04: ramo IG do dispatchOutbound + janela 24h/MESSAGE_TAG + extensão da union OutboundJob (kinds ig_*) em apps/workers/src/outbound/job.ts.
- F15-S06: ramo IG do connect (channels routes) — lista Page/IGBA, valida Business/Creator, subscribe webhook, cria channel + cifra token, test message. Exporta handlers; wire de app.ts é do orchestrator (se necessário).
- Executor único no harness (Task tool indisponível): orchestrator implementa cada slot na sua branch e integra. Paths disjuntos garantem zero colisão.

## F15 wave 2 — integrado (orchestrator) 2026-06-12
S02/S04/S06 done e em main. LIÇÃO: `vitest run <file>` NÃO typecheca; rodar `pnpm --filter <pkg> typecheck` ANTES do finish (S06 mergeou com erro de tuple-type no test → hotfix 1 commit em main). Daqui pra frente: typecheck do pacote sempre antes de finish.
- S03 (inbound persistence) desbloqueado (deps S01+S02 done). S05 espera S03+S04. S07 espera S06. S08 espera S05.
- Próxima onda: S03 (solo, workers/inbound) → depois S05 (api) + S07 (web) podem ir; S08 após S05.
