---
id: F47-S15
title: Polish — LiveChat full-bleed + picker de pipeline + 2 follow-ups
phase: F47
status: done
priority: medium
estimated_size: M
depends_on: [F47-S04, F47-S07, F47-S13]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-24T14:31:54Z
completed_at: 2026-06-24T14:45:38Z

---
# F47-S15 — Layout integrado do LiveChat + escolha de pipeline + follow-ups

Pedidos do founder + fechamento dos 2 follow-ups abertos da F47.

## Escopo (faz)

1. **LiveChat full-bleed** — o LiveChat hoje é um card `rounded-lg border` dentro do `<main>`
   com `px-4 py-6`, parecendo um painel solto. Tornar **totalmente integrado** à página:
   `<main>` sem padding/scroll na rota `/conversations` (full-bleed) e o `ConversationsLayout`
   preenchendo `h-full` sem a borda arredondada (desktop e mobile).
2. **Picker de pipeline ao "Criar card"** — `POST /api/conversations/:id/deal` passa a aceitar
   `pipelineId?`/`stageId?` (valida no workspace; fallback = default). No cockpit, a ação "Criar card"
   lista os pipelines para escolher em qual inserir.
3. **Follow-up dead-code** — consolidar `GET /api/deals/:id`: dobrar o read-through no handler
   canônico (`deals/crud.ts`) e remover o shadow de `pipeline/deal-conversation.ts`.
4. **Follow-up ApiError.issues** — `api-client.ts` passa a carregar `issues`; `ContactPanel` mostra
   qual campo falhou (não só a `message` genérica).

## Arquivos permitidos

- `apps/web/shared/components/layout/AppLayout.tsx`
- `apps/web/features/conversations/components/ConversationsLayout.tsx`
- `apps/web/features/conversations/components/DealSection.tsx`
- `apps/web/features/conversations/queries.ts`
- `apps/web/shared/lib/api-client.ts`
- `apps/web/features/contacts/components/ContactPanel.tsx`
- `apps/api/src/routes/pipeline/deal-conversation.ts`
- `apps/api/src/routes/deals/crud.ts`
- `apps/api/src/routes/pipeline/*.test.ts`, `apps/api/src/routes/deals/*.test.ts`

## Definition of Done

- [ ] `/conversations` ocupa a área inteira (sem card/borda/padding em volta), desktop e mobile.
- [ ] "Criar card" lista pipelines; o deal nasce no pipeline escolhido (entry stage); auto-enrich idem.
- [ ] `GET /api/deals/:id` único (canônico enriquecido); shadow removido; sem regressão de authz.
- [ ] Erro de validação do cadastro mostra o campo (issues); demais fluxos inalterados.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas

- `GET /api/pipelines` (`{ data }`) e `GET /api/pipelines/:id` (`{ pipeline, stages }`) já existem.
- Layout: usar `style height 100%` (o projeto evita `h-[calc]` por cascade em prod — ver comentário
  no ConversationsLayout). `<main>` full-bleed só na rota /conversations (não regressar outras telas).
