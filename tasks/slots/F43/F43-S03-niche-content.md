---
id: F43-S03
title: Conteúdo dos 7 nichos + registry (flows escalonados)
phase: F43
status: blocked
priority: high
estimated_size: L
depends_on: [F43-S02]
blocks: [F43-S04, F43-S09]
agent_id: backend-engineer
source_docs:
  - docs/features/ONBOARDING.md
---

# F43-S03 — Conteúdo dos 7 nichos + registry

> **source_docs:** `docs/features/ONBOARDING.md` §2.3
> **depends_on:** F43-S02 (tipo `NicheBlueprint`)
> **blocks:** F43-S04 (API resolve via registry), F43-S09 (flows restantes)

## Objetivo

Escrever os `NicheBlueprint` dos **7 nichos da landing** (Imobiliário, Saúde, Educação,
Solar, Varejo, Jurídico, Agências) + um registry `key → blueprint`, fechando o gap de
vaporware da landing.

## Contexto

Hoje só `real_estate` + `clinic` (apenas pipeline+agente). Aqui cada nicho ganha pacote
completo. Reaproveita os 2 existentes como base (pipeline + agente já definidos).

## Escopo (faz)

- `packages/db/src/seed/niches/blueprints/<niche>.ts` para os 7 nichos, cada um exportando um
  `NicheBlueprint` completo: pipeline + agente(s) + tags + tipos de conversão + departamentos
  + respostas rápidas.
- **Flows escalonados:** `real_estate`/`health`/`law` saem com `flows` populados
  (boas-vindas, qualificação, agendamento, recuperação); `education`/`solar`/`retail`/`agency`
  saem com `flows: []` (preenchidos em F43-S09).
- `packages/db/src/seed/niches/index.ts`: registry `NICHE_BLUEPRINTS` + `getBlueprint(key)`.
- Estender `seed/pipeline_templates.ts` e `seed/agent_templates_niche.ts` com os 5 nichos novos
  (mantendo os 2 existentes intactos), OU referenciá-los a partir dos blueprints — fonte única.
- Registrar os agent_templates novos no `seed.ts` (idempotente, padrão existente).

## Fora de escopo

- Tipo/instanciador (F43-S02). Endpoint (F43-S04). Flows dos 4 nichos restantes (F43-S09).

## Arquivos permitidos

- `packages/db/src/seed/niches/index.ts`
- `packages/db/src/seed/niches/blueprints/**`
- `packages/db/src/seed/pipeline_templates.ts`
- `packages/db/src/seed/agent_templates_niche.ts`
- `packages/db/src/seed.ts`

## Arquivos proibidos

- `packages/db/src/seed/niches/types.ts`, `seed/niches/instantiate.ts` (F43-S02)
- `apps/**`

## Contratos de saída

- `NICHE_BLUEPRINTS: Record<string, NicheBlueprint>` + `getBlueprint(key): NicheBlueprint | undefined`.
- 7 keys: `real_estate | health | education | solar | retail | law | agency`.

## Definition of Done

- [ ] 7 blueprints definidos; 3 com flows (`real_estate`/`health`/`law`), 4 com `flows: []`.
- [ ] Registry resolve as 7 keys; `getBlueprint` tipado (sem `any`).
- [ ] `pnpm --filter @hm/db test` + typecheck + lint verdes.
- [ ] Cada blueprint valida contra o tipo de F43-S02 (compila).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **backend-engineer**. Conteúdo pt-BR, realista por nicho (ex.: Jurídico = triagem
  de casos/LGPD; Solar = qualificação antes de proposta; Varejo = catálogo + recompra).
- Slot grande (L) por volume de conteúdo — se passar de ~500 linhas úteis, o orchestrator pode
  pedir split por grupos de nicho; deps e ownership de arquivos não mudam.
