# Runbook — Copiloto (F73): operação, custo, observabilidade e retenção

> **Para quem:** quem opera o `tagix` (plataforma) e o suporte que atende dono de empresa com dúvida sobre o Copiloto.
> **Escopo:** ligar e desligar por empresa, trocar o modelo, ler um turno pelo `ref`, investigar uma ação contestada, cuidar do custo, métricas e alertas, telemetria de produto e retenção do histórico.
> **Spec:** `docs/features/COPILOTO.md` (P7 sem caixa-preta, P8 custo tem teto, §9 métricas de sucesso). **Slot:** F73-S15.

> O Copiloto age **como a pessoa que pediu**, nunca acima dela, e toda ação passa por proposta, execução do Node e `audit_logs`. Nada neste runbook dá ao suporte um caminho para executar uma ação em nome de alguém: investigar é **ler** a trilha.

---

## 1. Ligar e desligar por empresa

O interruptor é `copilot_settings.enabled` (sem linha = ligado). Com ele desligado, **toda** rota `/api/copilot/*` responde 403 `copilot_disabled`, exceto `GET/PUT /settings` (quem desliga precisa da tela para religar). O orçamento do Copiloto e o dos agentes de atendimento são separados: desligar um não afeta o outro.

| Quem | Como |
|---|---|
| Dono ou admin da empresa (`copilot.manage`) | Configurações → Copiloto → "Copiloto ligado" (API: `PUT /api/copilot/settings` com `{ "enabled": false }`). A mudança entra em `audit_logs` como `copilot.settings.updated`. |
| Plataforma (emergência, empresa que não consegue acessar a tela) | SQL no papel owner (abaixo). Registre o motivo no ticket: esta via **não** grava `audit_logs` sozinha. |

```sql
-- Desligar (cria a linha com os defaults se não existir)
insert into copilot_settings (workspace_id, enabled) values ('<workspace_id>', false)
on conflict (workspace_id) do update set enabled = false, updated_at = now();
```

Por papel: a matriz de capacidades da empresa (`capability_matrix`, tela A11) pode tirar o uso de um papel (`{ "AGENT": { "use": false } }`): esse papel recebe 403 `copilot_disabled_for_role` e `GET /me` devolve `available: false`.

**Parar tudo na plataforma:** retire `AGENT_RUNTIME_URL`/`AGENT_RUNTIME_TOKEN` do ambiente da API. Todo turno novo termina em `runtime_unavailable` (sem custo); consultas já gravadas e a Atividade continuam funcionando.

## 2. Trocar o modelo

| Alcance | Onde | Efeito |
|---|---|---|
| Plataforma inteira | env `COPILOT_DEFAULT_MODEL` na API (padrão do código: `openai/gpt-4.1-mini`) e reinício da API | vale para toda empresa sem modelo próprio |
| Uma empresa | `copilot_settings.model` (a API pública **não** aceita este campo: é escolha da plataforma) | vale só para ela |

Regras que o código impõe:

- O modelo só vale se estiver **ativo** em `llm_models_whitelist` (`is_active = true`). Modelo fora da whitelist cai silenciosamente no padrão da plataforma; confira com a query abaixo depois de trocar.
- O preço por token vem da whitelist (`pricing_prompt_per_1m`, `pricing_completion_per_1m`). Sem preço, o custo do turno só existe se o provedor devolver `total_cost_usd`; senão conta como 0 e o teto fica cego para esse modelo. **Cadastre o preço antes de ativar um modelo para o Copiloto.**
- Trocar o modelo muda o custo médio por turno e a taxa de `format_fallback` (resposta fora do formato fixo). Antes de generalizar, rode a suíte de eval do runtime (`apps/agent-runtime`, portão de lançamento da §9 da spec) e compare `format_fallback` e custo por membro ativo em uma empresa piloto por 48 h.

```sql
-- Qual modelo cada empresa está de fato usando (últimos 7 dias)
select l.model, count(*) as turnos, round(sum(l.cost_usd), 4) as custo_usd
  from llm_usage_logs l
 where l.surface = 'copilot' and l.created_at >= now() - interval '7 days'
 group by l.model order by custo_usd desc;
```

## 3. Ler um turno pelo `ref`

O cliente nunca recebe stack nem texto do runtime: recebe `error { code, ref }` com `ref = hm_err_xxxxxxxx`. O suporte pede o `ref` (ou o horário e o nome da pessoa) e procura no log da API.

1. **Log estruturado** (Pino/JSON), pelo `ref`:
   - `copilot.turn_failed` (turno que falhou depois de começar): `code`, `runtime_code`, `detail`.
   - `copilot.turn_rejected` (recusa antes do turno: `rate_limited`, `budget_exceeded`, `turn_in_progress`, `runtime_unavailable`): `reason`.
   - `copilot.turn` (uma linha por turno, **sem conteúdo**): `turn_id`, `session_id`, `outcome`, `status`, `error_code`, `duration_ms`, `ttfb_ms`, `iterations`, `tool_calls`, `tainted`, `cost_usd`, `prompt_tokens`, `completion_tokens`, `model`, `budget_state`, `events`, `cards`, `iteration_exceeded`.
2. **Banco**, pelo `turn_id` (papel owner; **nunca** copie o conteúdo da conversa para o ticket: o histórico é privado do membro):

```sql
-- O turno (sem texto): estado, custo, ferramentas
select id, member_id, status, error_code, model, iterations, tool_calls, max_tool_calls,
       tainted, prompt_tokens, completion_tokens, cost_usd, started_at, completed_at
  from copilot_turns where id = '<turn_id>';

-- Cada chamada de ferramenta do turno (args já redigidos, sem PII)
select created_at, tool_key, decision, risk_level, error_code, duration_ms, result_meta
  from copilot_tool_calls where turn_id = '<turn_id>' order by created_at;

-- Custo gravado do turno (turno cancelado não grava custo)
select created_at, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, metadata
  from llm_usage_logs where copilot_turn_id = '<turn_id>';
```

Sinais úteis: `tainted = true` (o turno leu texto de contato; toda escrita dele sobe para confirmação); `decision = 'denied'` com `error_code = 'capability_denied:<motivo>'` (a permissão da pessoa não permitia); `decision = 'blocked'` (o motor bloqueou e gravou proposta `blocked`); `iteration_exceeded` / `iteration_limit` (o modelo girou até o teto de 8 iterações).

## 4. Investigar uma ação contestada ("o Copiloto mexeu no meu negócio")

Cadeia da trilha: **Atividade → proposta → itens → `audit_logs`**. Cada elo já existe na interface; o SQL abaixo é a versão do suporte.

1. **Atividade** (tela `/copiloto/atividade`, ou `GET /api/copilot/activity?scope=all` para quem tem `copilot.activity.view_all`): ache a linha pelo negócio, pessoa ou horário. Ela mostra quem pediu, o resultado e se foi desfeita.
2. **Proposta** (`GET /api/copilot/proposals/:id`):

```sql
select id, source, capability, risk_level, status, requested_by_member_id, executed_as_member_id,
       approver_member_id, summary, blocked_reason, created_at, confirmed_at, executed_at,
       completed_at, undo_deadline, undone_at, undone_by, turn_id, session_id
  from copilot_action_proposals where id = '<proposal_id>';
```

   `source = 'autopilot'` é o piloto automático (sugestão aprovada por uma pessoa); `executed_as_member_id` é a pessoa **cujas permissões foram usadas** (o aprovador, no fluxo de aprovação). No nível 2 (reversível) a proposta nasce já confirmada e executada na hora (`confirmed_at` = `executed_at`); nos níveis 3 e 4 a pessoa confirma antes.
3. **Itens** (um por alvo; `before`/`after` são o estado do registro; `skipped_conflict` = alguém mexeu antes e o Copiloto **não** sobrescreveu):

```sql
select position, target_type, target_id, status, error_code, before, after, executed_at, undone_at
  from copilot_action_items where proposal_id = '<proposal_id>' order by position;
```

4. **Auditoria** (uma linha por transição, na mesma transação da mudança):

```sql
select created_at, action, actor_type, actor_member_id, requested_by_member_id, copilot_turn_id, metadata
  from audit_logs where copilot_proposal_id = '<proposal_id>' order by created_at;
```

   `actor_type` é `copilot` ou `autopilot`; `actor_member_id` é o membro cujas permissões foram usadas.
5. **O que o domínio registrou**: `deal_history` / notas / eventos trazem `metadata.via = 'copilot'|'autopilot'` e `metadata.proposal_id`.
6. **Desfazer**: dentro de `undo_deadline`, a pessoa ou quem tem `copilot.activity.view_all` desfaz pela Atividade. O desfazer confere conflito por item (`undo_conflict` = o registro mudou depois e não foi revertido). Fora do prazo, é correção manual, registrada em ticket.
7. **De onde veio o pedido**: `turn_id` leva ao `copilot_turns` e às ferramentas chamadas (seção 3). O texto da pergunta mora em `copilot_messages` e é privado do membro; **só abra** com o consentimento da pessoa ou pedido legal, e fora do prazo de retenção ele já não existe (seção 8).

## 5. Custo: como o teto funciona e o que vigiar

- **Orçamento próprio**: `copilot_settings.monthly_budget_usd` (padrão US$ 30) por empresa, somando só `llm_usage_logs.surface = 'copilot'`. O orçamento dos agentes de atendimento é outro e não é tocado.
- **Estados** (mês corrente em UTC; renova no dia 1º): abaixo de `budget_alert_pct` (80%) `ok`; de 80% ao teto `alert`; no teto, `budget_mode = 'queries_only'` (padrão: escritas param, consultas seguem) ou `'pause'` (para tudo); em `queries_only`, o **teto duro é 120%** do orçamento (valor provisório, decisão de preço em aberto), depois pausa.
- **Antes de cada turno** o sistema estima o custo e recusa o que passaria do limite (`budget_exceeded`, sem turno gravado).
- **Limites por turno**: 8 iterações, 16 chamadas de ferramenta, 60 s no runtime (70 s no Node), resultado truncado. **Limite de taxa por membro**: 6/min e 300/dia.
- **Custo de turno cancelado não é gravado** (o provedor pode ter cobrado; o gasto real pode ficar acima do `spent_usd`). Em nível de plataforma, compare o `spent_usd` com a fatura do OpenRouter uma vez por mês.
- **Quem vê o custo**: só `copilot.view_costs` (OWNER e ADMIN). O custo nunca vai no stream do chat.

**Tela de uso** (`GET /api/copilot/usage`, `copilot.view_costs`): `spent_usd`, `cap_usd`, `pct`, `state`, `resets_on`, série diária (UTC), top 5 membros por custo, turnos e ações por nível. Moeda **US$**; mostrar em R$ depende da decisão de preço e é da interface.

**Alerta de orçamento**: um aviso aos OWNER ativos ao cruzar `budget_alert_pct` e outro ao chegar em 100% (uma vez por mês por limiar; ver o cabeçalho de `services/copilot/usage/budget-alert.ts`). Sai pela cascata de notificação com o evento `copilot_aprovacao` (não existe evento próprio ainda; quem silencia aprovações silencia este aviso). Se um dono diz "não recebi": cheque `notification_deliveries` pelo `event_key`:

```sql
select member_id, channel, status, suppressed_by, created_at
  from notification_deliveries
 where workspace_id = '<workspace_id>' and event_key like 'copilot_budget:%'
 order by created_at desc;
```

Chave do aviso: `copilot_budget:<AAAA-MM>:<limiar>`. Marca de "já avisado" no Redis: `hm:copilot-budget-alert:done:<workspace>:<AAAA-MM>:<limiar>` (40 dias). Para reenviar, apague a marca **e** a linha de `notification_deliveries` daquele membro e chave.

**Cuidados**:

- Subir `monthly_budget_usd` de uma empresa é decisão comercial: registre no ticket. O teto duro de 120% protege contra surpresa, mas ele escala junto com o orçamento.
- Modelo caro + `format_fallback` alto = o mesmo turno cobrado duas vezes. Observe `format_fallback_rate` nos insights antes de culpar o uso.
- Empresa com um membro respondendo por >60% do custo: normalmente é automação externa chamando a API de sessões em loop. O limite de taxa (300/dia) já contém, mas confira o `top_members` do `/usage`.
- `copilot_cost_usd_total` (Prometheus) soma a plataforma inteira, sem rótulo de empresa (cardinalidade). Custo por empresa: `/usage` ou a query de plataforma da seção 7.

## 6. Métricas e alertas

Métricas Prometheus da API (registry do `GET /metrics`, módulo `apps/api/src/observability/copilot-metrics.ts`). **Cardinalidade revisada: nenhum rótulo de `workspace_id`, `member_id`, `turn_id` ou texto livre.** Chave de ferramenta e capacidade passam por normalizador (formato + teto de 64 chaves; o resto vira `other`).

| Métrica | Rótulos | Quando |
|---|---|---|
| `copilot_turns_total` | `status`: `completed`, `failed`, `cancelled`, `budget_blocked`, `rate_limited`, `rejected` | fim de cada turno e cada recusa antes do turno (recusa não vira linha de `copilot_turns`) |
| `copilot_turn_duration_seconds` | `status`: `completed`, `failed`, `cancelled` | do pedido ao encerramento do turno (histograma, buckets 0,5 s a 60 s) |
| `copilot_ttfb_seconds` | — | do pedido até o frame `turn_started` (histograma; meta ≤ 800 ms p95) |
| `copilot_tool_calls_total` | `tool_key`, `decision` (`executed`, `proposed`, `blocked`, `denied`, `invalid_args`, `error`) | cada chamada de ferramenta, depois do commit do registro |
| `copilot_proposals_total` | `capability`, `risk_level` (1..4), `status` | cada mudança de status de proposta (não conta `adjusted`/`stop_requested`) |
| `copilot_cost_usd_total` | — | custo dos turnos concluídos |
| `copilot_runtime_unavailable_total` | — | turno que terminou em `runtime_unavailable` (runtime fora do ar ou sem configuração) |

Observações: o contador de propostas é incrementado dentro da transação da trilha; uma transação revertida pode contar a mais (raro, e é contador de tendência, não de contabilidade). A fonte de verdade de contagem é sempre o banco.

### Alertas (regras para `infra/prometheus/alerts.yml`)

O arquivo de regras não é deste slot; as três regras abaixo são o texto para quem o editar (grupo novo `leadium-copilot`, mesmo `job="leadium-api"` das demais):

```yaml
  - name: leadium-copilot
    rules:
      # p95 do tempo até o primeiro frame acima de 1,5 s por 10 min (meta da spec: 800 ms).
      - alert: LeadiumCopilotTtfbHigh
        expr: |
          histogram_quantile(0.95,
            sum by (le) (rate(copilot_ttfb_seconds_bucket{job="leadium-api"}[5m]))) > 1.5
        for: 10m
        labels: { severity: ticket }
        annotations:
          summary: 'Copiloto: p95 do TTFB acima de 1,5 s'
          description: 'O primeiro frame do SSE do Copiloto está lento há 10 min. Veja a seção 3 do runbook do Copiloto (copilot.turn: ttfb_ms) e a carga do banco.'

      # Taxa de erro acima de 5% (falhas ÷ concluídos+falhos; orçamento, limite de taxa e
      # cancelamento NÃO entram: não são erro do sistema). Mínimo de 10 turnos para não gritar à toa.
      - alert: LeadiumCopilotErrorRate
        expr: |
          (
            sum(rate(copilot_turns_total{job="leadium-api",status="failed"}[10m]))
              /
            clamp_min(sum(rate(copilot_turns_total{job="leadium-api",status=~"completed|failed"}[10m])), 1e-9)
              > 0.05
          )
          and
          (sum(increase(copilot_turns_total{job="leadium-api",status=~"completed|failed"}[10m])) >= 10)
        for: 10m
        labels: { severity: page }
        annotations:
          summary: 'Copiloto: mais de 5% dos turnos falhando'
          description: 'Procure copilot.turn_failed no log da API, agrupe por code/runtime_code (seção 3).'

      # Runtime (agent-runtime) indisponível: 3 turnos em 10 min terminaram em runtime_unavailable.
      - alert: LeadiumCopilotRuntimeUnavailable
        expr: sum(increase(copilot_runtime_unavailable_total{job="leadium-api"}[10m])) >= 3
        for: 2m
        labels: { severity: page }
        annotations:
          summary: 'Copiloto: runtime indisponível'
          description: 'O agent-runtime não está respondendo ao Copiloto. Cheque AGENT_RUNTIME_URL/TOKEN, o serviço agent-runtime e o OpenRouter.'
```

Sugestão de painel: p50/p95 de `copilot_turn_duration_seconds{status="completed"}` (meta p50 ≤ 4 s, p95 ≤ 10 s), taxa de `copilot_turns_total` por `status`, `copilot_tool_calls_total` por `decision` (pico de `denied` = papel/matriz mal configurados ou prompt injection), `copilot_proposals_total{risk_level="4"}`, e `increase(copilot_cost_usd_total[1d])`.

## 7. Telemetria de produto (sem conteúdo)

Só eventos e contagens: nenhuma pergunta, resposta, nome de contato ou valor de negócio.

**Por empresa**: `GET /api/copilot/insights` (`copilot.manage`, janelas de 7 e 30 dias). Devolve `members` (elegíveis, ativos na semana), `level3` (confirmadas, canceladas, expiradas, taxa de confirmação), `undo` (taxa de desfazer, e a do piloto à parte), `pilot` (aceite por estágio), `briefing` (visto no dia, no fuso da empresa) e `turns` (concluídos e com `format_fallback`). Taxas em fração 0..1; `null` quando não há base.

**Da plataforma** (entre empresas; papel owner, 30 dias; é a mesma conta do endpoint, agregada):

```sql
with w as (select now() - interval '7 days' as week, now() - interval '30 days' as period),
turns as (
  select
    count(distinct t.member_id) filter (where t.started_at >= w.week) as weekly_active_members,
    count(*) filter (where t.status = 'completed') as completed_turns,
    count(*) filter (where t.status = 'failed')    as failed_turns,
    count(*) filter (where t.status = 'cancelled') as cancelled_turns
  from copilot_turns t, w where t.started_at >= w.period
),
members_ok as (select count(*) as active_members from members where status = 'active'),
lvl3 as (
  select
    count(*) filter (where p.confirmed_at is not null)                        as confirmed,
    count(*) filter (where p.status = 'cancelled' and p.confirmed_at is null) as cancelled,
    count(*) filter (where p.status = 'expired'   and p.confirmed_at is null) as expired
  from copilot_action_proposals p, w
  where p.risk_level = 3 and p.source = 'copilot' and p.created_at >= w.period
),
undo as (
  select
    count(*) filter (where p.executed_at is not null) as executed,
    count(*) filter (where p.executed_at is not null
                       and (p.undone_at is not null or p.status in ('undone','partially_undone'))) as undone,
    count(*) filter (where p.source = 'autopilot' and p.executed_at is not null) as autopilot_executed,
    count(*) filter (where p.source = 'autopilot' and p.executed_at is not null
                       and (p.undone_at is not null or p.status in ('undone','partially_undone'))) as autopilot_undone
  from copilot_action_proposals p, w where p.created_at >= w.period
),
pilot as (
  select count(*) filter (where s.status in ('approved','auto_applied')) as accepted, count(*) as decided
  from copilot_suggestions s, w
  where s.status in ('approved','rejected','auto_applied') and s.decided_at >= w.period
),
brief as (
  select count(*) as ready,
         count(*) filter (where b.seen_at is not null
                            and (b.seen_at at time zone ws.timezone)::date = b.for_date) as seen_same_day
  from copilot_briefings b join workspaces ws on ws.id = b.workspace_id, w
  where b.status = 'ready' and b.for_date >= w.period::date
),
fallback as (
  select count(*) as format_fallback
  from llm_usage_logs l, w
  where l.surface = 'copilot' and l.created_at >= w.period and l.metadata ->> 'format_fallback' = 'true'
),
cost as (
  select coalesce(sum(l.cost_usd), 0) as cost_usd, count(distinct l.workspace_id) as workspaces_with_usage
  from llm_usage_logs l, w where l.surface = 'copilot' and l.created_at >= w.period
)
select
  turns.weekly_active_members, members_ok.active_members,
  round(turns.weekly_active_members::numeric / nullif(members_ok.active_members, 0), 4) as weekly_active_rate,
  turns.completed_turns, turns.failed_turns, turns.cancelled_turns,
  lvl3.confirmed, lvl3.cancelled, lvl3.expired,
  round(lvl3.confirmed::numeric / nullif(lvl3.confirmed + lvl3.cancelled + lvl3.expired, 0), 4) as confirm_rate,
  undo.executed, undo.undone, round(undo.undone::numeric / nullif(undo.executed, 0), 4) as undo_rate,
  round(undo.autopilot_undone::numeric / nullif(undo.autopilot_executed, 0), 4) as autopilot_undo_rate,
  pilot.accepted, pilot.decided, round(pilot.accepted::numeric / nullif(pilot.decided, 0), 4) as pilot_accept_rate,
  brief.ready, brief.seen_same_day, round(brief.seen_same_day::numeric / nullif(brief.ready, 0), 4) as briefing_seen_rate,
  fallback.format_fallback, round(fallback.format_fallback::numeric / nullif(turns.completed_turns, 0), 4) as format_fallback_rate,
  cost.cost_usd, cost.workspaces_with_usage,
  round(cost.cost_usd / nullif(turns.weekly_active_members, 0), 4) as cost_per_weekly_active_member
from turns, members_ok, lvl3, undo, pilot, brief, fallback, cost;
```

Como ler contra a spec (§9, 60 dias após o lançamento): `weekly_active_rate` ≥ 0,40; `confirm_rate` ≥ 0,60; `undo_rate` ≤ 0,05; `briefing_seen_rate` ≥ 0,50; **gatilho da v1.1 "mover sozinho"**: `pilot_accept_rate` ≥ 0,70 **e** `autopilot_undo_rate` ≤ 0,03 por 30 dias. Definições (a conta é a mesma no endpoint e aqui):

- *ativo semanal*: membro com ao menos um turno iniciado nos últimos 7 dias; *elegível* (no endpoint): membro ativo cujo papel e a matriz da empresa permitem usar o Copiloto (a query de plataforma usa todo membro ativo como denominador, então dá um número um pouco menor);
- *nível 3*: só propostas do Copiloto (o piloto automático é medido à parte); confirmada = tem `confirmed_at`; cancelada e expirada = sem confirmação;
- *desfazer*: propostas executadas que foram desfeitas (total ou parcial) ÷ executadas;
- *aceite do piloto*: sugestões aprovadas ÷ decididas (aprovadas + rejeitadas) nos últimos 30 dias, por estágio de origem; expiradas e pendentes não entram;
- *briefing visto no dia*: `seen_at` cai na própria `for_date` no fuso da empresa, entre os briefings `ready`;
- `format_fallback` fica em `llm_usage_logs.metadata` do turno concluído.

## 8. Retenção do histórico

A empresa escolhe 6, 12 ou 24 meses (`copilot_settings.history_retention_months`; sem linha = 12). Uma varredura **diária** nos workers (`apps/workers/src/retention/copilot-history.ts`, singleton por lock Redis `hm:lock:scheduler:copilot-history-retention`, em lotes) faz, por empresa:

| Passo | O que acontece | Quando |
|---|---|---|
| 1 | **Apaga** `copilot_messages` (pergunta, veredito, cartões) | `created_at` anterior ao prazo |
| 2 | **Apaga** `copilot_sessions` | `updated_at` anterior ao prazo, sem mensagem restante **e sem turno** |
| 3 | **Anonimiza e arquiva** a sessão (título e último contexto de página viram nulos; `archived_at` preenchido; some da lista) | `updated_at` anterior ao prazo, sem mensagem restante e **com** turno |

**Nunca apagados por esta varredura** (a trilha segue a política de auditoria, não o prazo do histórico): `copilot_action_proposals`, `copilot_action_items`, `copilot_tool_calls`, `copilot_turns`, `audit_logs` e `llm_usage_logs` (o custo do mês e a conta sobrevivem).

Por que o passo 3 existe: `copilot_turns.session_id` é obrigatório com `ON DELETE CASCADE`, e `copilot_tool_calls` cascateia do turno. Apagar uma sessão que tem turno levaria o turno e as chamadas de ferramenta junto, e a proposta perderia o elo com o turno que a gerou. Quase toda sessão real tem turno (a pergunta nasce junto dele); então o conteúdo sai por inteiro e fica só um casco sem texto. Para apagar também o casco, o schema teria de permitir `copilot_turns.session_id` nulo com `ON DELETE SET NULL` (pendência de schema; decisão do Rogério).

**Prazo atual de auditoria**: hoje **não existe expurgo automático de `audit_logs`**: as linhas ficam retidas até uma política de auditoria ser definida (fora deste slot). `copilot_action_proposals` (incluindo `args`, `preview` e `summary`) segue o mesmo prazo, e por isso **pode conter dados de negócio depois que o histórico de chat já foi apagado**: peça de exclusão por LGPD passa pelo fluxo de privacidade existente (`apps/workers/src/privacy`), não por esta varredura.

Operação:

- Cadência: a cada 24 h, com o primeiro tick 60 s depois do boot (mesmas variáveis do worker de retenção: `RETENTION_SWEEP_INTERVAL_MS`, `RETENTION_SWEEP_INITIAL_DELAY_MS`, `RETENTION_SWEEP_BATCH_SIZE` e `RETENTION_SWEEP_MAX_BATCHES`). O trabalho por tick é limitado a `batch × max_batches` somando empresas e passos; o resto fica para o tick seguinte.
- Log: `copilot history retention` (`messagesDeleted`, `sessionsDeleted`, `sessionsScrubbed`, `batches`, `reachedCap`, `errors`) quando houve trabalho. `reachedCap: true` em dias seguidos = backlog crescendo; suba `RETENTION_SWEEP_MAX_BATCHES`.
- `copilot_messages` não tem índice por `(workspace_id, created_at)`: a varredura filtra por `workspace_id` e `created_at` e lê a tabela daquela empresa uma vez por lote. Se a tabela passar de alguns milhões de linhas, peça o índice ao schema.
- Reduzir o prazo de uma empresa (24 → 6 meses) apaga o excedente na próxima varredura diária: não há como recuperar. A tela de configurações deve avisar antes de salvar.
- Conferir o resultado de uma empresa:

```sql
select count(*) filter (where created_at < now() - make_interval(months => <prazo>)) as mensagens_alem_do_prazo,
       count(*) as mensagens_total
  from copilot_messages where workspace_id = '<workspace_id>';
```

## 9. Agendadores e pontos de registro

| Agendador | Onde roda | Como é ligado |
|---|---|---|
| Retenção do histórico do Copiloto | `apps/workers` | **automático**: `startRetentionWorker` (já registrado no bootstrap dos workers) liga também esta varredura; para desligar, `copilotHistory: false` |
| Alerta de orçamento do Copiloto | processo da API | `startBudgetAlertScheduler()` de `services/copilot/usage` (tick de 5 min, lock Redis por empresa/mês/limiar). **Precisa ser registrado em `apps/api/src/server.ts`** ao lado do varredor de propostas e do briefing, e parado no shutdown (`scheduler.stop()`) |
