---
id: F73-S11
title: Memória do negócio (perfil da empresa, fatos com fonte, ensinar, corrigir e esquecer na hora) e a ferramenta remember_fact
phase: F73
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: false
depends_on: [F73-S01, F73-S03, F73-S05]
blocks: [F73-S14, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/decisions/ADR-004-motor-de-acoes-com-confirmacao-humana.md
agent_id: backend-engineer
---
# F73-S11 — Memória do negócio

## Objetivo

O Copiloto sabe o que a empresa vende, o ticket médio, o tom, o horário e as regras comerciais, porque a equipe escreveu. Também guarda fatos com fonte visível. Esquecer vale na hora para todas as conversas seguintes, e Corrigir cria um fato escrito por uma pessoa, que tem prioridade sobre o aprendido (A10).

## Contexto

O schema e o repo existem (S01). A sessão (S10) já injeta `listActiveForPrompt` em todo turno, então Esquecer é imediato por construção: o próximo turno não carrega o fato. A v1 **não** aprende sozinha das conversas (spec §10). Os fatos nascem de pessoas, do Copiloto a pedido (`remember_fact`) e, no futuro, de integrações (F75 grava `source_type='integration'` pelo repo).

## Escopo (faz)

- `apps/api/src/services/copilot/memory/**`:
  - `profile.ts`: chaves fixas `what_we_sell`, `avg_ticket`, `tone`, `hours`, `commercial_rules`, cada uma ≤ 500 caracteres. `upsertProfile` registra `audit_logs` (`copilot.memory.profile_updated`, sem o conteúdo).
  - `facts.ts`: `listFacts` (ativos e esquecidos recentes, com `source_label`, `created_by` e `updated_at`), `addFact` (por pessoa: `source_type='member'`, `source_label = 'Escrito por <nome>'`), `forget` / `restore` (restaurar só até 24 h depois de esquecer; depois disso é Ensinar de novo) e `correct` (o original vira `superseded` e o novo leva `source_type='member'`).
  - Limites: no máximo 200 fatos ativos por workspace. O 201º é recusado com mensagem clara: "Esqueça algum fato antes de ensinar outro".
  - O que vai para o prompt **não** é decidido aqui: a ordem, os limites e o corte são do `copilotMemoryRepo.listActiveForPrompt` (F73-S01), que a sessão (S10) já usa. Este slot garante, por teste, que Esquecer e Corrigir mudam o resultado dessa função na hora.
- Rotas `apps/api/src/routes/copilot/memory/**` (spec §5.2): leitura com `copilot.use`; escrita com `copilot.memory.edit`. Respostas no `MemoryProfileSchema` / `MemoryFactSchema`.
- Ferramenta `remember_fact` em `apps/api/src/internal/copilot/memory-tools/**`:
  - capacidade `memory.remember`, args `{ content ≤ 300, source_note ≤ 120 }`;
  - passa pelo **motor de propostas** (`makeProposeTool`, S05): nível 2 normalmente, **3 em turno contaminado** (ataque de memória envenenada, spec §8 R11);
  - desfazer = Esquecer;
  - `source_label = 'Pedido de <nome> ao Copiloto em <data>'`.

## Fora de escopo

- Interface (F74-S08). Aprender fatos automaticamente (v1.1). Busca semântica com `embedding` (v1.1).
- "Fontes conectadas" da A10. A v1 lista as fontes nativas: Conhecimento (contagem de documentos e data), Produtos, Pipeline e Inbox, com o estado lido das tabelas existentes, por `GET /api/copilot/memory/sources`. Integrações entram pela F75 por um seam: `registerMemorySource(provider)` em `memory/sources.ts`.

### files_allowed

- `apps/api/src/services/copilot/memory/**`
- `apps/api/src/routes/copilot/memory/**`
- `apps/api/src/internal/copilot/memory-tools/**`

### files_forbidden

- `apps/api/src/services/copilot/turns/**` (S10)
- `packages/**`

## Definition of Done

- [ ] CRUD de perfil e fatos com teste de permissão (AGENT lê e não escreve; SUPERVISOR escreve)
- [ ] Esquecer → `listActiveForPrompt` deixa de devolver o fato na chamada seguinte (teste); restaurar até 24 h; depois disso, 409
- [ ] Corrigir cria o fato novo `member` e marca o antigo `superseded`; o antigo não aparece mais no prompt
- [ ] `remember_fact` em turno contaminado gera proposta nível 3 (teste com o motor)
- [ ] Limite de 200 fatos ativos; perfil > 500 caracteres → 400
- [ ] Cross-tenant: fato de outro workspace → 404 em todas as rotas
- [ ] `GET /memory/sources` com contagens reais e o seam de fonte externa testado com um provider fake

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/services/copilot/memory src/routes/copilot/memory src/internal/copilot/memory-tools --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- "O Copiloto não usa nada fora desta lista, nem dados de outras empresas" é promessa de produto: o teste cross-tenant é parte dela.
