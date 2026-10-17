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
