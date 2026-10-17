---
id: F73-S06
title: Ferramentas de consulta do Copiloto, CRM (contatos, negócios, funil, agregações, previsão de receita) sob o escopo do membro
phase: F73
status: in-progress
priority: high
estimated_size: M
model: sonnet
ui: false
depends_on: [F73-S02, F73-S03]
blocks: [F73-S08, F73-S14, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/decisions/ADR-003-identidade-do-membro-nas-acoes-de-ia.md
  - docs/features/PIPELINE.md
  - docs/features/DASHBOARD.md
agent_id: backend-engineer
claimed_at: 2026-10-17T06:35:10Z

---
# F73-S06 — Consultas de CRM

## Objetivo

O Copiloto responde perguntas como "o que está travando o funil?", "previsão de receita do mês" e "quem são os negócios parados há 7 dias?" com dados reais, só do que o membro pode ver, e em cartões que a interface renderiza do jeito que vieram do banco.

## Contexto

Hoje as ferramentas de leitura dos agentes estão presas ao contato da conversa (`query_contact`, `query_deal`). O Copiloto precisa listar, buscar e agregar no workspace inteiro, mas com o escopo de quem pergunta (ADR-003 §4). Este slot é o nível 1 (consulta) do CRM. A operação (conversas, agenda, campanhas, KB) é do F73-S07.

## Escopo (faz)

Ferramentas em `apps/api/src/internal/copilot/read-crm/**`, cada uma um `CopilotToolDefinition` com Zod `.strict()`, `capability: 'query'`, a permissão da entidade e um cartão (`ToolResultCard`) com `source: { label, as_of: now, record_count }`:

| key | Args (resumo) | Permissão | Cartão |
|---|---|---|---|
| `search_contacts` | `query` (≤ 120), `limit ≤ 20` | `contact.view` | `table` |
| `get_contact` | `contact_id` | `contact.view` | `contact_card` (tags, origem/atribuição, negócios abertos, última conversa: data, sem conteúdo) |
| `list_deals` | `pipeline_id?`, `stage_ids?`, `owner_id?` (`'me'` aceito), `status?` (`open`\|`won`\|`lost`), `idle_days_gte?`, `value_gte?`, `value_lte?`, `created_from?/to?`, `sort` (`value_desc`\|`idle_desc`\|`created_desc`), `limit ≤ 50` | `pipeline.view` + escopo | `deal_list` (título, contato, valor, estágio, responsável, dias parado) |
| `get_deal` | `deal_id` | `pipeline.view` + escopo | `deal_card` (valor, parcelas se houver, estágio, tempo no estágio, histórico resumido dos últimos 5 eventos de `deal_history`, itens/produtos) |
| `aggregate_deals` | `group_by` (`stage`\|`owner`\|`source`\|`month`\|`product`), `metric` (`count`\|`sum_value`\|`avg_value`\|`avg_idle_days`\|`win_rate`), filtros iguais aos de `list_deals` | `pipeline.view` + escopo | `table` ou `series` |
| `get_pipeline_overview` | `pipeline_id?` | `pipeline.view` + escopo | `funnel` (por estágio: contagem, valor, conversão para o próximo, parados > 7 dias) |
| `forecast_revenue` | `period` (`this_month`\|`next_month`) | `pipeline.view` + escopo | `kpis` (fechado até hoje, previsto, intervalo, meta se houver) |
| `list_members` | `role?` | `pipeline.view` | `table` (nome, papel; **sem** e-mail nem telefone), para resolver "passa para a Paula" |

- **Escopo:** usar `dealScope`, `contactScope` e `resolveVisible` de `services/copilot/identity/scope.ts` (F73-S03), por import. Não criar predicado próprio: o escopo do Copiloto existe num só lugar.
- **"Dias parado"** = dias desde a última mensagem **do contato** na conversa vinculada; se não houver conversa, desde `deals.updated_at`. A regra vive num só lugar, `dealIdleDaysSql()` em `@hm/db` (F73-S01), porque o briefing (S12) e o piloto (S13) rodam também no worker e usam a mesma régua. Aqui só se importa.
- **Previsão** (`read-crm/forecast.ts`), explicável e documentada no cabeçalho do arquivo:
  - fechado = Σ ganhos no período;
  - previsto = fechado + Σ (valor do negócio aberto × p(estágio)), em que p(estágio) = ganhos ÷ (ganhos + perdidos) entre os negócios que passaram pelo estágio nos últimos 180 dias, com piso de 10 decididos (abaixo disso, p = taxa global do pipeline);
  - intervalo de 80% = ± 1,28 × √Σ (v² · p · (1 − p));
  - o cartão traz `why[]` com os 3 maiores componentes.
- Limites (`read-crm/limits.ts`): no máximo 50 linhas, `model_view` ≤ 24 KB serializado e `truncated: true` quando cortar; `statement_timeout` de 5 s por consulta (`applyDashboardStatementTimeout`, por import).
- **Separar o que vai para o modelo do que vai para a tela:** o `model_view` leva só o necessário para raciocinar (ids, números, nomes curtos). O cartão completo vai em `public_event`. Campos de texto livre de contato (nome de perfil, campos personalizados de texto) entram no `model_view` marcados `untrusted`, e a ferramenta que os devolve declara `taintsTurn: true` (`get_contact`, `search_contacts`).
- Ids desconhecidos ou fora do escopo → `not_found` (sem oráculo).
- Registrar todas em `read-crm/index.ts` (stub do S03).

## Fora de escopo

- Conversas, mensagens, agenda, campanhas, KB (S07). Qualquer escrita (S08).

### files_allowed

- `apps/api/src/internal/copilot/read-crm/**`

### files_forbidden

- `apps/api/src/services/dashboard/**` (só importar)
- `packages/**`

## Contratos

- Schemas de `data` por `kind`: `ToolResultCardSchema` (S02). Se faltar campo, abra nota em `tasks/COMMS.md` para o dono do S02. Não estenda localmente.

## Definition of Done

- [ ] Teste de integração por ferramenta (banco de dev, seed próprio do teste): feliz; escopo de AGENT (não vê negócio de outro responsável fora da sua visibilidade); cross-tenant (id de outro workspace → `not_found`); limite e `truncated`
- [ ] Previsão com teste de propriedade em casos pequenos calculados à mão (3 estágios, 6 negócios), incluindo o piso de 10 decididos
- [ ] `EXPLAIN` das consultas de `list_deals`, `aggregate_deals` e `get_pipeline_overview` com 50 mil negócios de seed sintético, registrado na nota; p95 ≤ 150 ms (índices existentes; se faltar índice, registre e abra pedido ao dono do schema, sem criar aqui)
- [ ] `model_view` ≤ 24 KB em todos os testes; `taintsTurn` nas ferramentas que devolvem texto livre de contato

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/internal/copilot/read-crm --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. Paralelo ao F73-S07 (pastas disjuntas).
- Nada de LLM aqui: números são SQL. O texto de `why[]` é montado de modelo de texto, em pt-BR, com `Intl` e o locale do workspace (nada de locale literal; regra da F59-S08).

## Nota de execução (backend-engineer, 2026-10-17)

### Entregue (`apps/api/src/internal/copilot/read-crm/`)

`index.ts` registra as 8 ferramentas (todas `capability: 'query'`, `requires` da entidade; `taintsTurn: true` só em `search_contacts` e `get_contact`). Peças: `limits.ts` (50 linhas, `model_view` ≤ 24 KB em bytes UTF-8 por busca binária do maior prefixo, `startRead` = `statement_timeout` 5 s via `applyDashboardStatementTimeout` + `jit = off`), `common.ts` (moeda do mercado/locale/fuso do workspace, `Intl`, máscara de telefone, `not_found` único), `deal-filters.ts` (Zod único dos filtros + SQL com `dealScope`), `forecast.ts` (puro, cabeçalho com a definição), e uma ferramenta por arquivo.

### Decisões

- **Escopo num só lugar**: `dealScope`/`contactScope`/`conversationScope`/`resolveVisible` por import; `resolveVisible` em `get_deal`, `get_contact` e nos `pipeline_id`. Inexistente, outro workspace e fora do escopo dão a MESMA resposta (`ok:false, decision:'executed', model_view:{error:'not_found',message}`, sem cartão).
- **Dias parado** só por `dealIdleDaysSql()`. Filtrar/ordenar por "parado" usa `lateral (select … offset 0)` para avaliar a régua uma vez por linha.
- **Consulta principal só em `deals`** (nomes de estágio/responsável/contato por PK depois). Com JOINs o planejador repetia o recorte por estágio (a régua de "parado" rodava 6x por negócio).
- **`jit = off`** em `startRead`: o predicado do AGENT tem dezenas de subplanos, o custo passa de `jit_above_cost` e o Postgres compila ~110 funções (mesma consulta: 18 ms sem JIT, 380 a 820 ms com). Vale também para S12/S13 (briefing e piloto no worker usam o mesmo `dealScope`).
- **Contaminação**: `model_view` de `get_contact`/`search_contacts` leva nome, nome de perfil e campos personalizados de TEXTO em `untrusted`; telefone e e-mail nunca vão ao modelo (cartão: telefone mascarado). As ferramentas de negócio levam título do negócio (recortado a 80, telefone mascarado se o título for um telefone), sem nome de contato, notas ou campos personalizados, e NÃO contaminam (conforme o slot). Risco residual para o auditor: o título pode vir do formulário de lead (`leadgen`) ou do nome do contato.
- **Previsão**: definição do slot, sem "data prevista de fechamento" (não existe no modelo): todo o funil aberto entra no previsto; o período só decide o que já está fechado (`next_month` dá fechado 0). Clamps: piso = fechado, teto = fechado + Σ aberto. Sem histórico nenhum, p = 0 e o `why` diz "sem histórico". Taxas e abertos respeitam o escopo do membro (AGENT: as próprias). `why[]` por modelo de texto pt-BR com `Intl` do workspace.
- **`aggregate_deals`**: status padrão `open` (exceto `win_rate`, só decididos); `month` = criação, ou fechamento em `win_rate`/`won`/`lost`; `product` soma os itens (não o valor do negócio), "Sem produto" para o resto; `avg_idle_days` por produto é recusado (`invalid_args`); `win_rate` é fração 0..1 (`format: 'percent'`). Mês vira `series`, o resto `table`.
- **`get_pipeline_overview`**: abertos por estágio; `conversion_to_next` = dos negócios criados nos últimos 180 dias que passaram pelo estágio (atual ou histórico `stage_changed`), a fração que chegou a estágio posterior; `null` no último e sem amostra.
- **`list_members`**: só ativos; arg extra `query` (nome) para achar "a Paula" (fora do resumo do slot, útil para o modelo).

### Resultados

- `read-crm.integration.test.ts` 48 testes (callback real, banco de dev), `forecast.test.ts` 13 (3 estágios, 6 negócios, piso de 10 decididos, calculado à mão), `limits.test.ts` 5. Todo `model_view` dos testes é conferido ≤ 24 KB.
- **EXPLAIN / latência com 50 mil negócios** (`explain.integration.test.ts`, só com `HM_EXPLAIN_50K=1`; workspace descartável apagado; conferido: 0 workspaces e 0 negócios sobrando no dev). Semente pessimista: 35 mil abertos, 30 mil conversas, 60 mil mensagens, 42 mil eventos de histórico. Handler real, 20 execuções, p95 (ms), máquina compartilhada:

  | consulta | OWNER | AGENT |
  |---|---|---|
  | `list_deals` (maiores, 50) | 45 | 28 |
  | `list_deals` (mais parados, `idle_days_gte` 7) | 139 | — |
  | `aggregate_deals` estágio × soma / responsável × taxa / mês × contagem | 34 / 16 / 70 | — |
  | `aggregate_deals` estágio × `avg_idle_days` | 135 | 48 |
  | `get_pipeline_overview` | **232** | 94 |
  | `forecast_revenue` | 86 | 79 |

  Planos: `list_deals`/`aggregate_deals` = `Seq Scan on deals` (70% das linhas casam) + top-N/`GroupAggregate`; a régua é `Bitmap Index Scan on idx_messages_conversation_created` por negócio (3,7 µs sob RLS). `get_pipeline_overview` = `Index Scan idx_deals_workspace_pipeline_stage` + a régua em 35 mil negócios (~130 ms no plano com instrumentação) + coorte de conversão (2 leituras de `deal_history`).
- **Fora do DoD (p95 ≤ 150 ms): `get_pipeline_overview` OWNER (232 ms)** nesta semente. O custo é linear na régua de "parado" (`dealIdleDaysSql`, S01) × negócios abertos; a ~25 mil abertos cabe em 150 ms. As formas dependentes da régua têm teto de regressão de 400 ms no teste, com o motivo no código.
- **Pedido ao dono do schema (S01, não criado aqui)**: índice parcial `messages (conversation_id, (coalesce(provider_timestamp, created_at)) desc) where direction = 'inbound'`. Medido numa transação revertida (nada persistiu; `pg_indexes` conferido): a contagem de "parados" nos 35 mil abertos foi de 79 ms para 48 ms (-40%). Solução definitiva: coluna persistida `deals.last_inbound_at` mantida por trigger.

### Campos que faltaram nos schemas de `@hm/shared` (não estendidos)

- `deal_card.installments`: o modelo de dados não tem parcelamento de negócio; sai sempre `null`.
- `kpis` sem meta: não existe meta de receita no produto; o cartão não mostra "meta".
- `ValueFormat 'percent'`: o contrato não diz se é fração ou 0..100; aqui é fração 0..1 (como `conversion_to_next`). A interface (F74) precisa saber.
- `table.rows` sem tipo de célula `boolean`/`date` real; datas vão como string ISO com `format: 'date'`.
