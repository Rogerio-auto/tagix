---
id: F3-S07
title: Feedback loop — citações do agente + marcar útil/não-útil (kb_feedback)
phase: F3
status: blocked
priority: medium
estimated_size: S
depends_on: [F3-S01, F3-S05, F3-S06]
---
# F3-S07 — Feedback loop (citações + útil/não-útil)

> **source_docs:** `docs/DATA_MODEL.md` §8.3 (`kb_feedback`); `docs/UX_PRINCIPLES.md` §3; `docs/ROADMAP.md` F3-S05
> **blocks:** —

## Objetivo
Fechar o ciclo de qualidade da KB: quando o agente cita um documento (via `search_knowledge_base`, F3-S05), o usuário marca a citação como **útil / não-útil**, persistindo em `kb_feedback`. O sinal alimenta o ranking de retrieval (já consumido por F3-S05) e aparece como estatística no documento.

## Escopo (faz)
- `apps/api/src/routes/knowledge/feedback.ts`: factory de router (montada em `app.ts` pelo orchestrator) — `POST /api/knowledge/feedback` `{ document_id, chunk_id?, agent_id?, conversation_id?, helpful: boolean, reason? }` sob RLS + Zod; `GET` agregado por documento (helpful/total) para a UI.
- `apps/web/features/knowledge/feedback/**`: componente `<KbCitation>` reutilizável (mostra título/fonte + 👍/👎) e hook de marcação.
- `apps/web/features/agents/playground/**`: renderizar citações do `payload.results` no transcript do Playground e plugar o `<KbCitation>` (é onde se testa o agente e se vê a fonte).

## Fora de escopo
- Schema (F3-S01, já cria `kb_feedback`), retrieval/ranking (F3-S05 já lê o agregado), CRUD de docs (F3-S04).

## Arquivos permitidos
- `apps/api/src/routes/knowledge/feedback.ts`
- `apps/web/features/knowledge/feedback/**`
- `apps/web/features/agents/playground/**`

## Arquivos proibidos
- `apps/api/src/routes/knowledge/documents*` e demais arquivos de F3-S04 (router de CRUD é dono de F3-S04 — este slot usa router próprio).

## Contratos de entrada
- Consome `payload.results[].{ document_id, chunk_id, title }` do `search_knowledge_base` (contrato de F3-S05).

## Definition of Done
- [ ] `POST /api/knowledge/feedback` grava `kb_feedback` sob RLS, validado por Zod; dedup razoável (não exigido pelo schema, mas evite spam óbvio).
- [ ] Citações do agente aparecem no Playground com ação útil/não-útil que persiste e dá feedback visual.
- [ ] Escrita exige sessão autenticada (`kb.edit`); leitura do agregado idem.
- [ ] `pnpm --filter @hm/api test` + `pnpm --filter @hm/web build` + lint/typecheck verdes.

## UX considerations
- §3 micro-feedback: a marcação confirma com transição sutil (sem toast intrusivo); estado idempotente (re-clicar não duplica visualmente); tokens DS v2.
- Citação é affordance discreta sob a resposta do agente, não um bloco que compete com o texto.

## Permission scope
- Escrita/leitura de feedback gated por `kb.edit` (MANAGERS). Se quiser permitir STAFF marcar durante teste, ajustar para `agent.playground` — decisão registrada aqui; default `kb.edit`.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer** (API fina + foco em UI de citação).
- Tocar arquivos do Playground (F2-S19, já done) é seguro: não há slot paralelo neles. Renderiza citações a partir do `final`/tool-result que F3-S05 passou a devolver.
