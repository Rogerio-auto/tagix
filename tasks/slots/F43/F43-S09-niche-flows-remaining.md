---
id: F43-S09
title: Flows dos 4 nichos restantes (Educação/Solar/Varejo/Agências)
phase: F43
status: blocked
priority: low
estimated_size: S
depends_on: [F43-S03]
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/ONBOARDING.md
---

# F43-S09 — Flows dos nichos restantes

> **source_docs:** `docs/features/ONBOARDING.md` §2.3
> **depends_on:** F43-S03 (blueprints existem com `flows: []` nesses 4 nichos)

## Objetivo

Preencher os `flows` prontos (boas-vindas, qualificação, agendamento, recuperação) dos 4 nichos
que saíram sem flows em F43-S03: Educação, Solar, Varejo, Agências.

## Contexto

F43-S03 entregou esses 4 com `flows: []` (escalonamento). Este slot fecha o pacote — edição
**sequencial** dos mesmos arquivos de blueprint (permitido: S03 já estará `done`).

## Escopo (faz)

- Editar `seed/niches/blueprints/{education,solar,retail,agency}.ts` adicionando os `flows`
  do nicho, no mesmo formato dos 3 nichos já completos.

## Fora de escopo

- Engine/instanciador (S02). Outros recursos do blueprint (já em S03).

## Arquivos permitidos

- `packages/db/src/seed/niches/blueprints/education.ts`
- `packages/db/src/seed/niches/blueprints/solar.ts`
- `packages/db/src/seed/niches/blueprints/retail.ts`
- `packages/db/src/seed/niches/blueprints/agency.ts`

## Arquivos proibidos

- `packages/db/src/seed/niches/index.ts`, `seed/niches/instantiate.ts`, `seed/niches/types.ts`
- `apps/**`

## Definition of Done

- [ ] Os 4 nichos passam a ter flows não-vazios, válidos contra o tipo.
- [ ] `pnpm --filter @hm/db test` + typecheck + lint verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **backend-engineer**. Baixa prioridade — completude de conteúdo, não bloqueia o first-run.
