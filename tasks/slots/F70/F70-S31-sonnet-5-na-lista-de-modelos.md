---
id: F70-S31
title: Sonnet 5 na lista de modelos e no agente da Arcada
phase: F70
status: review
priority: medium
estimated_size: S
depends_on: [F70-S06]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md
agent_id: backend-engineer
claimed_at: 2026-09-25T20:32:21Z
completed_at: 2026-09-25T20:43:29Z

---
# F70-S31 — Sonnet 5 na lista de modelos e no agente da Arcada

## Objetivo

O Claude Sonnet 5 poder ser escolhido nos agentes do Leadium e ser o modelo do agente da Arcada. Decisão do Rogério em 25/09.

## Contexto

- A S06 usou `anthropic/claude-sonnet-4`, o Sonnet mais novo da whitelist do Leadium naquele momento.
- O roteamento é pelo OpenRouter: o id do modelo precisa ser confirmado na lista pública de modelos do OpenRouter, com fonte e data. Não se inventa id.
- Decisão registrada junto: o "toque de 30 dias" da cadência conta a partir da etiqueta `esfriou` (dia 37 desde a última mensagem), que é como a S06 já implementou.

## Escopo

### files_allowed

- whitelist e catálogo de modelos (localizar: `packages/shared/src/**`, `packages/db/src/seed/**`, `apps/agent-runtime/app/**` — anotar o caminho exato no slot antes de editar)
- `packages/db/src/seed/agent_templates_arcada*.ts`
- `packages/db/drizzle/**` *(se o catálogo for dado no banco)*
- testes ao lado

### Caminhos localizados (antes de editar, 25/09)

- **Catálogo/whitelist global (Node):** `packages/db/src/seed/llm_models.ts` — seed idempotente de
  `llm_models_whitelist` (upsert por `slug`). É a única lista de modelos do Leadium: `GET /api/agents/models`
  (`apps/api/src/routes/agents/models.ts`) lista as linhas ativas; o seed da Arcada faz fail-fast nela.
  O catálogo é **dado no banco semeado por código**, não migração: nenhuma migração é necessária.
- **Whitelist do runtime (Python):** `apps/agent-runtime/app/policy.py` (`model_block_reason`) — não há
  catálogo estático no runtime; ele bloqueia pelo `allowed_models` da policy do workspace que o Node envia
  (`packages/agents-core/src/policy-resolver.ts`). Teste ao lado: `apps/agent-runtime/tests/test_policy.py`.
- **Modelo da Arcada:** `packages/db/src/seed/agent_templates_arcada.content.ts` (`ARCADA_MODEL`).
- **Testes:** `packages/db/src/seed/llm_models.test.ts` (novo), `packages/db/src/seed/agent_templates_arcada.test.ts`.
- `packages/shared/src/**`: nenhum catálogo de modelos lá (grep por `claude-`/`sonnet`/`gpt-4o-mini`).

## Escopo (faz)

- Confirmar o id exato do Sonnet 5 no OpenRouter (fonte e data no slot) e o preço, para o teto de custo.
- Incluir o modelo na whitelist e no catálogo, com a mesma política de planos dos outros Sonnet, e documentar.
- Seed da Arcada passa a usar o Sonnet 5. O agente já existe e está inativo, então a mudança entra como rascunho de versão, e o Rogério publica.

## Definition of Done

- [x] teste: o modelo passa pela whitelist do runtime e do Node
- [x] seed re-rodado no dev gera o rascunho com o modelo novo, sem tocar no live
- [x] fonte do id do modelo registrada

## Fonte do id do modelo

- **Id:** `anthropic/claude-sonnet-5` ("Anthropic: Claude Sonnet 5"). Existe também a variante
  `anthropic/claude-sonnet-5:batch` (metade do preço, assíncrona), que não entra: o atendimento é síncrono.
- **Fonte:** `GET https://openrouter.ai/api/v1/models` (lista pública, sem chave), consultada em **25/09/2026**.
  `created` = 1782843083 (30/06/2026).
- **Preço por token:** entrada `0.000002` USD, saída `0.00001` USD, ou seja **US$ 2 / US$ 10 por 1M tokens**
  (o Sonnet 4 custa US$ 3 / US$ 15). Cache: leitura `0.0000002`, escrita `0.0000025`.
- **Contexto:** 1.000.000 tokens, saída máxima 128.000. `supported_parameters` inclui `tools`; entrada aceita
  texto, imagem e arquivo.

## Decisões

- **Catálogo = seed, não migração.** `llm_models_whitelist` é dado global semeado por
  `packages/db/src/seed/llm_models.ts` (upsert por `slug`). Nenhuma migração: a 0093 não foi usada.
- **Planos:** `defaultPlanKeys = ['business']`, igual ao Sonnet 4, a geração que o Sonnet 5 sucede
  (o Claude 3.5 Sonnet, mais antigo, está em `pro`+`business`). O teste trava a paridade com o Sonnet 4.
- **Teto de custo:** o `cost-guard` (`packages/agents-core/src/cost-guard.ts`) lê o preço de
  `llm_models_whitelist`; com `max_tokens: 600` a saída máxima de um turno custa US$ 0,006 (antes US$ 0,009).
  Continua sem teto por conversa (ver F70-S06).
- **Runtime:** não tem catálogo próprio. Ele bloqueia pelo `allowed_models` da policy do workspace; a policy
  vazia libera tudo. O teste cobre o Sonnet 5 permitido e bloqueado.
- **Seed da Arcada:** `ARCADA_MODEL = 'anthropic/claude-sonnet-5'`. Com o agente já existente, a troca vira
  rascunho (`vN draft`) pelo caminho que a S06 já tinha (compara prompt + modelo + params). O `note` do
  rascunho passa a citar o modelo, e a CLI diz "prompt ou modelo mudou". O template do workspace
  (`agent_templates.default_model`) é atualizado, como já era; o agente e o live não mudam.

## Validação

Rodado localmente (Postgres de dev em `localhost:5442`):

- `packages/db`: `llm_models.test.ts` (4) + `agent_templates_arcada.test.ts` (13, com o novo
  "troca de modelo vira RASCUNHO") = **17 testes passando**. `tsc --noEmit` do `@hm/db` limpo; ESLint e
  Prettier limpos nos arquivos tocados.
- Runtime: `pytest tests/test_policy.py` = **16 passando** (1 novo); `ruff check` e `ruff format --check` limpos.
  Rodado com o `.venv` do checkout principal (sem `uv` no PATH deste shell), por isso fora do bloco abaixo.
- Seed no workspace `dev`: 1ª rodada `criado: prompt_version:2:draft`; 2ª rodada `nada (idempotente)`.
  Estado final: `1:live:anthropic/claude-sonnet-4`, `2:draft:anthropic/claude-sonnet-5`, mesmo prompt
  nas duas, agente com `anthropic/claude-sonnet-4` e `inactive`.

```bash
pnpm --filter @hm/db typecheck
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/seed/llm_models.test.ts src/seed/agent_templates_arcada.test.ts --maxWorkers=1
```

## Pendências e riscos

- **Produção, antes do seed da Arcada:** o seed faz fail-fast se o Sonnet 5 não estiver ativo em
  `llm_models_whitelist`. Rodar antes o seed de modelos ou o sync da OpenRouter (Plataforma → Modelos). O
  sync cria a linha ativa, mas com `default_plan_keys` vazio; o seed grava `['business']`.
- **Policy do workspace:** se o `allowed_models` da Arcada em produção for uma lista não vazia sem o
  Sonnet 5, o runtime bloqueia o agente. O seed avisa nesse caso; o super-admin libera em Plataforma → Policies.
- **Publicar:** Agentes → "Arcada — atendimento" → Versões → publicar o rascunho com o Sonnet 5.
- Fora da fronteira: o `anthropic/claude-3.5-sonnet` do catálogo não aparece mais na lista pública do
  OpenRouter (25/09). Vale um slot de higiene do catálogo.
