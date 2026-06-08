# Feature — DASHBOARD (role-aware)

> **Domínio:** Tela inicial e visão analítica adaptada ao role do usuário.
> **Pacotes:** `apps/web/features/dashboard/`, `apps/api/src/routes/dashboard`, `apps/api/src/services/metrics`
> **Princípio fundador:** dashboard reflete o que o usuário pode **agir**, não o que ele pode **ver**. Métrica que o role não pode operar = ruído.

---

## 1. Por que role-aware

O v1 tinha "uma tela de KPIs pra todo mundo" e isso falhou em duas frentes:

- **Agente** ficava perdido em métricas agregadas (NPS médio do workspace, custo total OpenAI) que não interessam pra ele — ele quer saber **quem está esperando ele responder agora**.
- **Owner** entrava no dashboard e via os mesmos números do agente — não havia visão financeira/saúde do negócio.

O v2 define **5 dashboards distintos** (um por role) + 1 plataforma (super-admin). Cada um responde a uma pergunta concreta:

| Role | Pergunta que o dashboard responde |
|---|---|
| **AGENT** | "O que eu preciso fazer agora?" |
| **SUPERVISOR** | "Como minha equipe está performando? Onde tem gargalo?" |
| **ADMIN** | "O workspace está saudável? O que precisa atenção?" |
| **OWNER** | "Estamos ganhando dinheiro? O negócio está crescendo?" |
| **READONLY** | "Como está o workspace?" (visão sem ação) |
| **platform_admin** | "A plataforma está saudável? Quem consome mais? Onde tem alerta?" |

Hierarquia é **aditiva**: ADMIN vê tudo do SUPERVISOR + AGENT, OWNER vê tudo do ADMIN, platform_admin vê tudo de todos os workspaces que ele acessar.

---

## 2. Catálogo de métricas

Cada métrica tem **fonte de dados**, **cadência de atualização** e **roles que veem**. Listadas em ordem de implementação no MVP.

### 2.1 Atendimento (AGENT/SUPERVISOR/ADMIN/OWNER)

| Métrica | Fonte | Update | AGENT | SUP | ADMIN | OWNER |
|---|---|---|:-:|:-:|:-:|:-:|
| `minhas_conversas_abertas` | conversations WHERE assigned_to=me AND status='open' | socket | ✅ | — | — | — |
| `minha_fila_pendente` | conversations WHERE assigned_to=me AND status='pending' | socket | ✅ | — | — | — |
| `aguardando_atribuicao` | conversations WHERE assigned_to IS NULL AND status='pending' | socket | — | ✅ (do team/dept dele) | ✅ (workspace) | ✅ |
| `em_atendimento_ia` | conversations WHERE ai_mode='on' | socket | ✅ (das minhas) | ✅ (do team) | ✅ | ✅ |
| `tempo_medio_primeira_resposta_24h` | messages — agrega por conv | 5min | ✅ (minha média) | ✅ (do team) | ✅ | ✅ |
| `tempo_medio_resolucao_24h` | conversations — agrega closed_at − opened_at | 5min | — | ✅ | ✅ | ✅ |
| `sla_violado_hoje` | conversations onde tempo resposta > limite do plano/workspace | 5min | — | ✅ | ✅ | ✅ |
| `resolvidas_hoje_por_mim` | messages onde sender=me + conversation closed | snapshot ao fechar | ✅ | ✅ (do team) | ✅ | — |
| `volume_inbound_24h` | messages WHERE direction='inbound' GROUP BY hora | 1h | — | ✅ | ✅ | ✅ |
| `volume_outbound_24h` | messages WHERE direction='outbound' GROUP BY hora | 1h | — | ✅ | ✅ | ✅ |
| `inbox_por_canal` | conversations GROUP BY channel.provider, status | 5min | — | ✅ | ✅ | ✅ |
| `inbox_por_departamento` | conversations GROUP BY department_id, status | 5min | — | ✅ | ✅ | ✅ |
| `transferencias_24h` | conversation_routing_history últimas 24h | 5min | — | ✅ | ✅ | — |

### 2.2 Pipeline / vendas (SUPERVISOR/ADMIN/OWNER)

| Métrica | Fonte | Update | SUP | ADMIN | OWNER |
|---|---|---|:-:|:-:|:-:|
| `deals_por_stage` | deals GROUP BY stage_id | 5min | ✅ (do team) | ✅ | ✅ |
| `valor_total_pipeline` | sum(deals.value_cents) WHERE NOT closed | 5min | ✅ | ✅ | ✅ |
| `deals_fechados_ganho_mes` | deals WHERE closed_won=true AND closed_at >= mes | 1h | ✅ | ✅ | ✅ |
| `deals_fechados_perdido_mes` | deals WHERE closed_won=false AND closed_at >= mes | 1h | ✅ | ✅ | ✅ |
| `taxa_conversao_mes` | won / (won + lost) do mês | 1h | ✅ | ✅ | ✅ |
| `ticket_medio` | avg(deals.value_cents WHERE closed_won) | 1h | — | ✅ | ✅ |
| `deals_estagnados_7d` | deals onde updated_at < now - 7d AND NOT closed | 1h | ✅ (do team) | ✅ | — |
| `previsao_fechamento_mes` | sum(deals.value_cents × stage.probability) | 1h | — | ✅ | ✅ |

### 2.3 Campanhas (SUPERVISOR/ADMIN/OWNER)

| Métrica | Fonte | Update | SUP | ADMIN | OWNER |
|---|---|---|:-:|:-:|:-:|
| `campanhas_ativas` | campaigns WHERE status='running' | socket | ✅ | ✅ | ✅ |
| `disparos_24h` | campaign_deliveries WHERE sent_at > now-24h | 5min | ✅ | ✅ | ✅ |
| `delivery_rate_24h` | delivered / sent agregado | 5min | ✅ | ✅ | ✅ |
| `block_rate_24h` | blocked / sent agregado | 5min | ✅ (alerta) | ✅ (alerta) | — |
| `quality_rating_canais` | channels.metadata.quality_rating | socket | — | ✅ | ✅ |
| `campanhas_em_risco` | campaign_metrics WHERE health_status IN ('warning','critical') | 5min | ✅ (alerta) | ✅ (alerta) | — |
| `opt_outs_24h` | contacts WHERE opt_out_at > now-24h | 1h | — | ✅ | ✅ |

### 2.4 Agentes IA (SUPERVISOR/ADMIN/OWNER)

| Métrica | Fonte | Update | SUP | ADMIN | OWNER |
|---|---|---|:-:|:-:|:-:|
| `conversas_em_atendimento_ia_agora` | conversations WHERE ai_mode='on' | socket | ✅ | ✅ | ✅ |
| `agente_handoffs_24h` | tool_logs WHERE tool='transfer_to_human' | 1h | ✅ | ✅ | — |
| `agente_resolucoes_24h` | tool_logs WHERE tool='mark_resolved' | 1h | ✅ | ✅ | — |
| `custo_llm_hoje_usd` | sum(llm_usage_logs.cost_usd WHERE today) | 5min | — | ✅ | ✅ |
| `custo_llm_mes_usd` | sum(llm_usage_logs.cost_usd WHERE current_month) | 1h | — | ✅ | ✅ |
| `tokens_por_modelo_24h` | llm_usage_logs GROUP BY model | 1h | — | ✅ | — |
| `latencia_agente_p95_24h` | agent_executions agregada | 1h | — | ✅ | — |
| `cap_mensal_consumido_pct` | custo_mes / policy.max_monthly_cost_usd × 100 | 1h | — | ✅ (alerta) | ✅ (alerta) |

### 2.5 Conversões (AGENT/SUPERVISOR/ADMIN/OWNER)

> **Nota:** "conversão" no v2 é um **evento explícito registrado** (vide §13). Cada workspace define **o que conta como conversão** (venda fechada, agendamento marcado, contrato assinado, etc.). Sem conversão registrada = volume sem resultado = métrica de vaidade. Toda métrica aqui depende de conversões existirem.

| Métrica | Fonte | Update | AGENT | SUP | ADMIN | OWNER |
|---|---|---|:-:|:-:|:-:|:-:|
| `conversoes_minhas_mes` | conversion_events WHERE triggered_by_member_id=me AND mes | snapshot | ✅ | ✅ (do team) | ✅ | ✅ |
| `valor_convertido_minhas_mes` | sum(conversion_events.value_cents WHERE triggered_by_member=me) | snapshot | ✅ | ✅ | ✅ | ✅ |
| `conversoes_workspace_mes` | conversion_events WHERE workspace AND mes | 5min | — | ✅ | ✅ | ✅ |
| `valor_convertido_workspace_mes` | sum(value_cents) workspace mês | 5min | — | ✅ | ✅ | ✅ |
| `taxa_conversao_mes` | conversoes / contatos_novos_mes × 100 | 1h | — | ✅ | ✅ | ✅ |
| `ticket_medio_conversao` | avg(value_cents WHERE value_required) | 1h | — | ✅ | ✅ | ✅ |
| `conversoes_por_tipo` | GROUP BY conversion_type | 1h | — | ✅ | ✅ | ✅ |
| `conversoes_por_canal` | GROUP BY attributed_channel_id | 1h | — | ✅ | ✅ | ✅ |
| `conversoes_por_campanha` | GROUP BY attributed_campaign_id (top 5) | 1h | — | ✅ | ✅ | ✅ |
| `conversoes_por_agente_ia` | GROUP BY triggered_by_agent_id | 1h | — | ✅ | ✅ | ✅ |
| `conversoes_por_atendente_humano` | GROUP BY triggered_by_member_id (ranking) | 1h | — | ✅ | ✅ | ✅ |
| `conversao_por_origem` (UTM/source contact) | conversion_events JOIN contacts.source | 1h | — | ✅ | ✅ | ✅ |
| `tempo_medio_ate_conversao` | avg(conversion.occurred_at - contact.created_at) | 1d | — | ✅ | ✅ | ✅ |
| `funil_de_conversao` (por stage de pipeline) | deals → conversions agregado | 1h | — | ✅ | ✅ | ✅ |

### 2.6 Negócio (OWNER apenas)

| Métrica | Fonte | Update |
|---|---|---|
| `contatos_total_workspace` | count(contacts WHERE NOT deleted) | 1h |
| `novos_contatos_mes` | contacts WHERE created_at >= mes | 1h |
| `taxa_crescimento_contatos` | mes_atual / mes_anterior | 1d |
| `roi_estimado_mes` | valor_convertido_mes − custos_operacionais (LLM + infra) | 1d |
| `cac_aproximado` | (custo_campanhas + custo_LLM) / conversoes_pagas | 1d |
| `mrr_aproximado` (se billing ativo) | subscriptions.plan_id agregado | 1d |
| `usuarios_ativos_workspace_7d` | members WHERE last_seen_at >= 7d | 1h |

### 2.7 Plataforma (platform_admin apenas)

| Métrica | Fonte | Update |
|---|---|---|
| `workspaces_ativos` | workspaces WHERE subscription_status='active' | 1h |
| `workspaces_em_trial` | workspaces WHERE subscription_status='trial' | 1h |
| `top_10_workspaces_por_gasto_llm_mes` | llm_usage_logs GROUP BY workspace_id ORDER BY cost DESC | 1h |
| `workspaces_acima_cap` | onde gasto_mes / cap >= 90% | 1h |
| `volume_mensagens_plataforma_24h` | messages agregada | 1h |
| `incidentes_meta_24h` | webhook_events WHERE error agregada por canal | 5min |
| `health_infra_overview` | snapshot Postgres/Redis/RabbitMQ/workers/agent-runtime | 1min |
| `dlq_size_total` | RabbitMQ DLQ counts | 1min |

---

## 3. Layout role-aware

### 3.1 AGENT

Tela enxuta, foco em "o que eu preciso fazer":

```
┌──────────────────────────────────────────────────────────┐
│  Bom dia, <nome>                          [filtro: hoje] │
├──────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐   │
│  │ 12      │  │  3      │  │ 8       │  │ 1m 42s   │   │
│  │ Minhas  │  │ Em fila │  │ IA      │  │ Tempo    │   │
│  │ abertas │  │         │  │ rodando │  │ médio    │   │
│  └─────────┘  └─────────┘  └─────────┘  └──────────┘   │
│  → click em qualquer card abre /conversations filtrada  │
├──────────────────────────────────────────────────────────┤
│  Próximas ações (top 5 conversas aguardando você)        │
│  • João Silva — última resposta há 18 min                │
│  • Maria Souza — aguardando agendamento                  │
│  • ...                                                   │
├──────────────────────────────────────────────────────────┤
│  Resolvidas hoje: 14  |  Tempo médio resposta: 1m 30s   │
├──────────────────────────────────────────────────────────┤
│  Minhas conversões (mês): 8  |  Valor: R$ 12.400         │
│  → click leva pra histórico de conversões filtrado por mim│
└──────────────────────────────────────────────────────────┘
```

Sem chart pesado. Sem agregação que não muda nada pro dia dele. **A linha de conversões só aparece se o workspace tem ao menos um `conversion_type` configurado** (vide §13) — workspace que ainda não definiu conversão não mostra esse bloco.

### 3.2 SUPERVISOR

Adiciona visão de equipe + alertas:

```
┌──────────────────────────────────────────────────────────┐
│  Equipe                              [filtro: 24h ▼]    │
├──────────────────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│  │ 47   │ │ 12   │ │ 8    │ │ 3    │ │ 2    │          │
│  │ Open │ │ Pend │ │ IA   │ │ SLA  │ │ Bloq │          │
│  │      │ │ atr  │ │      │ │ viol │ │ camp │          │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘          │
├──────────────────────────────────────────────────────────┤
│  ⚠ Alertas (2)                                          │
│  • Joana — 3 conversas há mais de 30 min sem resposta   │
│  • Campanha "Black Friday" — quality YELLOW             │
├──────────────────────────────────────────────────────────┤
│  Performance por atendente (tabela ordenável)            │
│  Atendente  | Abertas | Resolvidas | T. médio | SLA      │
│  ─────────────────────────────────────────────────────   │
│  João       | 12      | 24         | 1m 30s  | OK       │
│  Maria      | 8       | 31         | 0m 45s  | OK       │
│  Carlos     | 18      | 12         | 4m 20s  | ⚠        │
├──────────────────────────────────────────────────────────┤
│  Pipeline da equipe (cards por stage com soma R$)        │
│  Volume inbound últimas 24h (chart linha)                │
├──────────────────────────────────────────────────────────┤
│  Conversões da equipe (este mês)                         │
│  Total: 47   |   Valor: R$ 184k   |   Taxa: 12%         │
│  Por atendente (ranking ordenável):                      │
│  Joana   18 conv / R$ 71k   |   ⭐ top performer        │
│  Maria   14 conv / R$ 52k                               │
│  Carlos   8 conv / R$ 31k                               │
│  → click no nome filtra histórico de conversões         │
├──────────────────────────────────────────────────────────┤
│  Conversões por canal e por campanha (charts)            │
└──────────────────────────────────────────────────────────┘
```

### 3.3 ADMIN

Foco em saúde do workspace + ações administrativas:

```
┌──────────────────────────────────────────────────────────┐
│  Workspace: <nome>                    [filtro: 30d ▼]   │
├──────────────────────────────────────────────────────────┤
│  Saúde geral                                             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                    │
│  │ 142  │ │ 89%  │ │ R$48 │ │ 2/8  │                    │
│  │ Conv │ │ Deliv│ │ Custo│ │ Camp │                    │
│  │ /dia │ │ rate │ │ IA   │ │ ativ │                    │
│  └──────┘ └──────┘ └──────┘ └──────┘                    │
├──────────────────────────────────────────────────────────┤
│  ⚠ Atenção                                              │
│  • Canal IG "@lojaXYZ" — token expira em 12 dias        │
│  • Cap mensal IA em 78% (R$390 de R$500)                │
│  • Quality rating WhatsApp principal: YELLOW            │
├──────────────────────────────────────────────────────────┤
│  Tendência últimos 30 dias                              │
│  • Volume de mensagens (chart)                          │
│  • Custo LLM acumulado (chart)                          │
│  • Conversões (deals fechados) (chart)                  │
├──────────────────────────────────────────────────────────┤
│  Canais conectados (lista com status visual)            │
│  Departamentos / times (cards com volume e atendentes)  │
└──────────────────────────────────────────────────────────┘
```

### 3.4 OWNER

Adiciona camada financeira + crescimento:

```
┌──────────────────────────────────────────────────────────┐
│  Negócio                              [filtro: mês ▼]   │
├──────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ R$ 184k  │ │ 12%      │ │ R$ 3.9k  │ │ +12%     │    │
│  │ Convert  │ │ Taxa     │ │ Ticket   │ │ Cresc    │    │
│  │ mês      │ │ conversão│ │ médio    │ │ contatos │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ R$ 84k   │ │ R$ 527   │ │ 160:1    │ │ R$ 8     │    │
│  │ Pipeline │ │ Custo    │ │ ROI      │ │ CAC      │    │
│  │ aberto   │ │ op mês   │ │ aprox    │ │ aprox    │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
├──────────────────────────────────────────────────────────┤
│  Funil do mês (visualização afunilada)                   │
│  Lead 124 → Qualificado 89 → Proposta 42 → Fechado 16   │
│  ↳ Conversões marcadas: 47  (inclui agendamentos + venda)│
├──────────────────────────────────────────────────────────┤
│  Custos operacionais                                     │
│  • LLM (OpenRouter): R$ 195/mês                         │
│  • Storage R2: R$ 12/mês                                │
│  • VPS + infra: R$ 320/mês                              │
│  • Total: R$ 527/mês                                    │
├──────────────────────────────────────────────────────────┤
│  + tudo que o ADMIN vê                                  │
└──────────────────────────────────────────────────────────┘
```

### 3.5 READONLY

Mesma visão do ADMIN, **sem** os botões de ação. Cards são informativos, links navegam pra páginas em modo só-leitura.

### 3.6 platform_admin (super-admin)

Dashboard separado em `/platform` (vide [`ARCHITECTURE.md`](../ARCHITECTURE.md) §11.2):

```
┌──────────────────────────────────────────────────────────┐
│  Plataforma                                              │
├──────────────────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                    │
│  │ 142  │ │ 28   │ │ 3    │ │ 0    │                    │
│  │ Wks  │ │ Trial│ │ ⚠ cap│ │ DLQ  │                    │
│  └──────┘ └──────┘ └──────┘ └──────┘                    │
├──────────────────────────────────────────────────────────┤
│  Top 10 workspaces por gasto LLM (este mês)              │
│  1. Workspace ABC      R$ 1.240   gpt-4o + claude-3.5    │
│  2. ...                                                  │
├──────────────────────────────────────────────────────────┤
│  Saúde da infra                                          │
│  • Postgres: 12 conexões / 200; slow queries: 0          │
│  • Redis: 73% memória; hit rate 94%                      │
│  • RabbitMQ: queue lag inbound: 4 msg                    │
│  • agent-runtime (2 réplicas): latência p95 1.2s         │
│  • Workers: heartbeats OK                                │
├──────────────────────────────────────────────────────────┤
│  Incidentes Meta últimas 24h: 0                          │
│  Audit log de plataforma (últimas 20 ações)              │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Drill-down (clicar leva à página filtrada)

Cada card de stat é um link tipado para a página correspondente já filtrada:

| Card | Destino |
|---|---|
| "Minhas abertas" | `/conversations?assigned_to=me&status=open` |
| "Em fila" | `/conversations?assigned_to=null&status=pending` |
| "IA rodando" | `/conversations?ai_mode=on` |
| "Campanhas ativas" | `/campaigns?status=running` |
| "Deals em proposta" | `/pipeline?stage=proposta` |
| "Custo IA hoje" | `/platform/llm-usage?period=today` (se platform_admin) ou `/settings/usage` (workspace) |
| "Convertido mês" | `/conversions?period=mes` |
| "Conversões por canal" | `/conversions?group_by=channel` |
| "Top performer" (nome) | `/conversions?member_id=<X>&period=mes` |

Nunca mostre um número sem destino. Número sem ação = ruído.

**UX do drill-down:** clicar em card pode (a) **navegar** pra página da feature já filtrada (links da tabela acima — mantém histórico de navegação) ou (b) abrir um **drawer lateral** sobre o próprio dashboard se o conteúdo for compacto (ex: top 5 conversas aguardando, detalhe de alerta). Modal full-screen é **proibido** pra drill-down (vide [`UX_PRINCIPLES.md`](../UX_PRINCIPLES.md) §2.3). Lista por trás permanece visível em drawer; em navegação, breadcrumb permite voltar 1-click.

---

## 5. Atualização: realtime vs snapshot

| Cadência | Tipo de métrica | Mecanismo |
|---|---|---|
| **Socket** (segundos) | Estado operacional do agente (minhas, fila, IA rodando) | Socket.io eventos `dashboard:metric_changed` filtrados por role |
| **5 min** | Volumes agregados curtos (24h windows) | Job no scheduler popula `dashboard_snapshots` table; frontend faz `useQuery` com `refetchInterval: 5*60_000` |
| **1 hora** | Métricas de tendência (volume_24h_chart, custo_mes) | Materialized views refreshed por cron |
| **1 dia** | Métricas estratégicas (crescimento, MRR) | Job noturno |

Anti-padrão: tudo realtime = peso desnecessário no DB e ruído visual (números pulando o tempo todo).

---

## 6. Customização pessoal (per-member)

Cada member pode:

- **Esconder cards específicos** (não interessantes pra ele) — preferência salva em `members.dashboard_layout` (jsonb).
- **Reordenar cards** com drag-and-drop simples.
- **Definir período padrão** (hoje / 7d / 30d / mês).
- **Definir tema escuro/claro** (já existente, sincronizado com sistema).

Limites:
- Não pode esconder cards marcados como **obrigatórios** pelo ADMIN.
- Não pode adicionar métricas que o role dele não permite (visualmente nem disponíveis pra adicionar).

---

## 7. Customização administrativa (per-workspace)

ADMIN define em `/settings/dashboard`:

- **Cards obrigatórios** para cada role (ex: forçar "SLA violado" sempre visível pra SUPERVISOR).
- **Limites de SLA** (tempo máximo de resposta) — definem quando "SLA violado hoje" dispara.
- **Limites de alerta** (ex: avisar quando custo LLM > 80% do cap, quando block_rate > 1.5%).

---

## 8. API

| Endpoint | Quem usa | Retorno |
|---|---|---|
| `GET /api/dashboard/me` | Frontend ao carregar dashboard | Estrutura: `{ role, cards: [...], alerts: [...], layout_preferences: {...} }` |
| `GET /api/dashboard/metrics/:metric_key` | Frontend pra drill-down detalhado | Time series ou tabela |
| `WS dashboard:metric_changed` | Socket.io | `{ workspace_id, member_id, metric_key, new_value }` — broadcast filtrado por role |
| `PATCH /api/members/me/dashboard-layout` | Frontend ao reordenar/esconder card | 204 |

Filtragem server-side: `GET /api/dashboard/me` retorna **apenas** os cards/métricas que o role tem direito de ver. Frontend nunca tenta esconder algo que veio do server — server não envia.

---

## 9. Implementação técnica

### 9.1 Server Component carrega snapshot inicial

```tsx
// app/(app)/page.tsx (dashboard root)
import { loadDashboard } from '@/features/dashboard/server/load-dashboard';
import { DashboardClient } from '@/features/dashboard/components/DashboardClient';

export default async function DashboardPage() {
  const dashboard = await loadDashboard();   // SSR — query rápida, primeira pintura completa
  return <DashboardClient initial={dashboard} />;
}
```

### 9.2 Client component hidrata + escuta socket

```tsx
'use client';
import { useDashboardSocket } from '../hooks/useDashboardSocket';

export function DashboardClient({ initial }: { initial: DashboardSnapshot }) {
  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard.get,
    initialData: initial,
    refetchInterval: 5 * 60 * 1000,
  });
  useDashboardSocket();   // invalida queries em eventos relevantes
  return <Grid cards={data.cards} alerts={data.alerts} layout={data.layout_preferences} />;
}
```

### 9.3 Materialized views Postgres

Métricas agregadas pesadas (volume 24h, custo mês) saem de materialized views (já mencionadas em DATA_MODEL §15). Refresh por job.

---

## 10. Anti-padrões (não fazer)

- ❌ Mostrar gráfico pesado pra AGENT — ele quer agir, não analisar.
- ❌ Mostrar custo de plataforma pra READONLY — sem ação possível.
- ❌ Realtime em métrica agregada (`volume_24h`) — não muda significativamente entre dois segundos.
- ❌ Card sem drill-down — número solto não vale nada.
- ❌ Misturar canais em métrica única quando o role atua só em um — segmenta.
- ❌ Reusar mesma tela pra todos os roles e esconder partes com `if (role !== 'agent')` no JSX — feito no v1, virou bagunça. No v2 a server-side decide e envia só o que o role pode ver.
- ❌ Permitir que SUPERVISOR veja métricas pessoais de outro SUPERVISOR fora do team dele — vaza dado de equipe.

---

## 11. Métricas operacionais (do dashboard como produto)

Auto-instrumentação:
- `dashboard_load_time_p95_ms` — tempo até primeira pintura completa.
- `dashboard_socket_events_per_minute` — peso do realtime.
- `dashboard_card_clicks_by_role_metric` — quais drill-downs são usados (alimenta priorização).

Se um card nunca é clicado por nenhum role em 30 dias, considera remover.

---

## 12. Não-objetivos MVP

- ❌ Dashboard custom 100% drag-drop com criar gráficos novos — fase 2.
- ❌ Export PDF/Excel de relatórios — fase 2.
- ❌ Agendar relatório semanal por email — fase 2.
- ❌ Comparativo "este mês vs mês passado" lado-a-lado — pode entrar pós-MVP se demanda.
- ❌ Forecasting / projeção de vendas — fase 2.

---

## 13. Sistema de conversões

> **Lacuna do v1:** não havia conceito de conversão. Workspaces viam volume de mensagens mas não sabiam quantas viraram negócio. No v2, conversão é entidade de primeira classe.

### 13.1 Conceito

**Conversão = evento marcado** que representa "o objetivo de negócio aconteceu". O que conta como conversão é **definido pelo workspace**, não pelo Highermind. Exemplos por nicho:

| Nicho | Possíveis tipos de conversão |
|---|---|
| Imobiliária | Visita agendada • Proposta assinada • Contrato fechado • Escritura |
| Clínica | Consulta marcada • Primeiro atendimento • Tratamento iniciado • Plano contratado |
| Advocacia | Diagnóstico concluído • Contrato assinado • Audiência marcada |
| Digital (agência) | Diagnóstico feito • Proposta enviada • Contrato assinado • Onboarding completo |
| Escritório (contabilidade) | Cadastro completo • Contrato assinado • Primeira competência paga |

Cada tipo configurável tem:
- **slug** (`venda_fechada`)
- **label** ("Venda fechada")
- **cor** + **ícone** (visual)
- **value_required** (true se obriga digitar valor; false se é evento puro tipo "agendamento")
- **value_label** ("Valor da venda" vs "Valor estimado")
- **moeda** (default BRL)
- **default no nicho** (templates de nicho — vide PRD §3.3 #4 — já trazem 2-3 tipos sugeridos)

### 13.2 Como uma conversão é registrada

Cinco caminhos, todos resultam em row em `conversion_events`:

| Origem | Quando |
|---|---|
| **Manual via UI** | Member clica "Marcar conversão" na conversa, no deal, ou no contato. Modal pequena: tipo + valor + nota. |
| **Stage automation** | Pipeline stage com flag `triggers_conversion: <conversion_type_key>` → deal entra no stage → conversão registrada automaticamente com `deal.value_cents`. |
| **Tag aplicada** | Tag específica configurada como gatilho (`tag.conversion_type_key`) → tag entra no contato → conversão registrada. |
| **Tool do agente IA** | Nova tool `register_conversion(type, value?, note?)` na categoria `workflow`. Agente registra quando o contato confirma a ação (ex: "Confirmo o agendamento pra terça"). Aprovação humana configurável. |
| **API externa / webhook** | `POST /api/v1/conversions` com API key autenticada. Útil pra integrar gateway de pagamento, CRM externo, ERP. |

### 13.3 Atribuição

Cada `conversion_events` carrega **atribuição** opcional:

- `attributed_campaign_id` — qual campanha trouxe esse contato (usa attribution window padrão 30 dias da última delivery → conversion).
- `attributed_channel_id` — canal de origem (WhatsApp / Instagram / WAHA).
- `attributed_agent_id` — agente IA que estava ativo na conversa quando a conversão aconteceu.
- `triggered_by_member_id` — o atendente humano que marcou (ou que estava atendendo).
- `triggered_by_flow_id` — flow que levou à conversão (se houve).

Isso alimenta os charts "conversões por campanha", "por canal", "por atendente", "por agente IA".

### 13.4 UI

**Onde aparece o botão "Marcar conversão":**

- **No header da conversa** — botão verde-neon discreto à direita. Aparece SE workspace tem ao menos 1 `conversion_type` configurado.
- **No DealDetailDrawer (Pipeline)** — botão na barra de ações. Pré-preenche o tipo "venda" se o deal está em stage marcado como `is_won`.
- **No contato (Contacts CRM)** — botão na barra de ações do contato.
- **Quickbar de manual flows** já existente (vide [`FLOW_BUILDER.md`](./FLOW_BUILDER.md) §7.5) — pode incluir flow que registra conversão.

**Modal de marcação:**

```
┌─────────────────────────────────────┐
│  Marcar conversão                   │
├─────────────────────────────────────┤
│  Tipo: [Visita agendada      ▼]    │  ← lista de conversion_types do workspace
│  Valor: [R$  3.500,00       ]      │  ← só aparece se type.value_required
│  Nota:  [______________________]   │
│  Atribuir à campanha: [Black Fri ▼]│  ← sugerido se houver delivery recente
│                                     │
│  [Cancelar]            [Registrar]  │
└─────────────────────────────────────┘
```

### 13.5 Configuração

Em `/settings/conversions`, ADMIN/OWNER:

- Lista tipos de conversão (CRUD).
- Define quais stages do pipeline disparam conversão automática.
- Define quais tags disparam conversão.
- Define attribution window (padrão 30 dias).
- Define se conversões manuais precisam aprovação de SUPERVISOR (default: não).

### 13.6 Edge cases

- **Conversão duplicada same-day** — `UNIQUE(workspace_id, contact_id, conversion_type_id, date_trunc('day', occurred_at))` previne duplo registro acidental no mesmo dia. Pode ser sobrescrito com confirmação dura na UI.
- **Conversões repetidas em dias diferentes (por design)** — é permitido. Um mesmo contato pode ter múltiplas conversões do mesmo tipo em datas diferentes (clínica com retornos recorrentes, agência com renovações de contrato). UI exibe histórico em ordem cronológica.
- **Conversão retroativa** — member pode marcar `occurred_at` no passado (até 90 dias). Auditoria registra com flag explícito.
- **Cancelamento** — conversão pode ser marcada `cancelled_at` (venda caiu, agendamento cancelado). Não deleta (mantém audit). Métricas excluem `cancelled_at IS NOT NULL` automaticamente.
- **Sem nenhum `conversion_type` cadastrado** — UI esconde botão e cards do dashboard. Onboarding sugere criar 2-3 tipos baseado no nicho do workspace.
- **Multi-attribution (mais de um responsável)** — atribuição segue regra de **prioridade fixa**, não compartilhamento de valor:
  1. Se foi registrada manualmente por um member → `triggered_by_member_id = me` ganha atribuição.
  2. Caso contrário, se foi disparada por tool de agente → `triggered_by_agent_id` ganha.
  3. Caso contrário, se foi disparada por flow → `triggered_by_flow_id` ganha.
  4. Caso contrário, é `source='deal_won'` / `'tag_added'` / `'api'` / `'webhook'`.

  Modelo de "split de comissão entre agente IA + atendente humano" não é objetivo do MVP. Quando precisarem, virar `conversion_attribution_weights jsonb` numa fase futura.
- **Atribuição multi-canal (contato chegou por canal A, converteu em canal B)** — `attributed_channel_id` recebe **o canal da última conversa inbound** dentro do `attribution_window_days` (default 30d) antes da conversão. Se nenhuma → NULL. UTM/source do contact (`contacts.source`) é métrica separada (`conversao_por_origem`).
- **Atribuição multi-campanha** — `attributed_campaign_id` recebe a campanha cuja última delivery ao contato é mais recente E dentro do attribution window. Se nenhuma → NULL.

### 13.7 Schema (resumo; completo em DATA_MODEL §nova-seção)

```sql
CREATE TABLE conversion_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key             text NOT NULL,                              -- slug
  label           text NOT NULL,
  color           text NOT NULL DEFAULT '#1FFF13',
  icon            text,
  value_required  boolean NOT NULL DEFAULT false,
  value_label     text,                                       -- "Valor da venda"
  currency        text NOT NULL DEFAULT 'BRL',
  is_default      boolean NOT NULL DEFAULT false,             -- aparece selecionado primeiro
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE conversion_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversion_type_id      uuid NOT NULL REFERENCES conversion_types(id) ON DELETE RESTRICT,
  contact_id              uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id         uuid REFERENCES conversations(id) ON DELETE SET NULL,
  deal_id                 uuid REFERENCES deals(id) ON DELETE SET NULL,
  value_cents             bigint,
  currency                text NOT NULL DEFAULT 'BRL',
  note                    text,
  source                  text NOT NULL CHECK (source IN ('manual','deal_won','tag_added','agent_tool','api','webhook','flow')),
  triggered_by_member_id  uuid REFERENCES members(id) ON DELETE SET NULL,
  triggered_by_agent_id   uuid REFERENCES agents(id) ON DELETE SET NULL,
  triggered_by_flow_id    uuid REFERENCES flows(id) ON DELETE SET NULL,
  attributed_campaign_id  uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  attributed_channel_id   uuid REFERENCES channels(id) ON DELETE SET NULL,
  attribution_window_days integer NOT NULL DEFAULT 30,
  occurred_at             timestamptz NOT NULL DEFAULT now(),
  cancelled_at            timestamptz,
  cancelled_reason        text,
  metadata                jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_events_workspace_occurred ON conversion_events(workspace_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;
CREATE INDEX idx_conv_events_member ON conversion_events(triggered_by_member_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;
CREATE INDEX idx_conv_events_type ON conversion_events(conversion_type_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;
-- Prevenção de duplicata casual
CREATE UNIQUE INDEX uq_conv_events_dedup ON conversion_events(workspace_id, contact_id, conversion_type_id, date_trunc('day', occurred_at))
  WHERE cancelled_at IS NULL;
```

### 13.8 Tool agente: `register_conversion`

Categoria `workflow`. Schema:

```ts
{
  type_key: string,            // slug do conversion_type (ex: 'visita_agendada')
  value_cents?: number,        // obrigatório se type.value_required
  note?: string,
}
```

Aprovação humana: configurável por workspace (`workspace_agent_policies.allow_agent_conversions`). Default: ligado para `value_required=true` (envolve dinheiro); desligado pra tipos sem valor (agendamentos).

Caso aprovação ligada e agente tente registrar: `interrupt` no LangGraph, mensagem "Agente sugere registrar conversão: <tipo> R$ <valor>. Aprovar?" no dashboard do SUPERVISOR.

### 13.9 Página `/conversions` (drill-down)

Lista paginada com filtros (período, tipo, atendente, canal, campanha, agente). Tabela ordenável + chart sumário em cima. Export CSV.

### 13.10 Anti-padrão: "métrica sem conversão"

Em mensagens à empresa, **volume é vaidade; conversão é negócio**. Cuidado com:

- ❌ Card "Volume de mensagens" sem comparar com conversões — workspace acha que está performando porque manda muita mensagem, sem saber se converte.
- ❌ Métrica de agente "atendeu 1.000 contatos" sem mostrar "converteu 40" — ranking falso de produtividade.
- ❌ Custo LLM sem custo por conversão — owner não sabe se IA paga o próprio custo.

O dashboard do v2 deve **sempre que possível** mostrar a relação volume → conversão lado a lado.

---

> Princípio fechado: **um dashboard só não serve a cinco roles diferentes**. Cinco dashboards focados servem. E sem **conversão registrada**, nenhum dashboard responde à pergunta que importa: "estamos ganhando dinheiro?"
