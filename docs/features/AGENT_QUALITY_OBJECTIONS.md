# Feature — Qualidade de atendimento, satisfação (CSAT) e objeções (LLM-judge)

> **Domínio:** Camada analítica que mede **qualidade da resposta** (humana e IA), **satisfação do contato** (CSAT) e **objeções** recorrentes — a partir das conversas já existentes, sem fricção para o cliente final.
> **Pacotes:** `packages/db` (schema), `apps/agent-runtime` (LLM-judge), `apps/workers` (gatilho+persistência), `apps/api/src/services/dashboard` + `apps/web/features/dashboard` (superfície).
> **Fase:** F29 (Dashboard "Onda B"). Continua a Onda A ([`DASHBOARD.md`](./DASHBOARD.md) §2.4/§3.2) com métricas qualitativas.
> **Decisão travada:** método **LLM-judge** (avaliação pós-conversa via OpenRouter no agent-runtime). Satisfação por **análise de sentimento** do diálogo — sem survey ao contato. Custo de LLM é aceito como overhead operacional.

---

## 1. Por quê

A Onda A mede **volume e produtividade** (quantas conversas, quão rápido, quantas conversões). Não responde **"o atendimento foi bom?"** nem **"por que o cliente não fechou?"**. Para o usuário OWNER/ADMIN trabalhar as dores reais, faltam três sinais qualitativos:

1. **Qualidade da resposta** — o atendente (humano ou agente IA) respondeu com clareza, correção, tom adequado e resolveu?
2. **Satisfação (CSAT)** — o contato saiu satisfeito? (medido por sentimento, não por survey).
3. **Objeções rankeadas** — quais resistências aparecem mais ("tá caro", "vou pensar", "não confio", "concorrente X")? Ranqueadas, viram um mapa de dores para trabalhar script, oferta e treinamento.

Princípio (herdado de [`DASHBOARD.md`](./DASHBOARD.md) §13.10): **volume é vaidade; qualidade e objeção dizem onde está o dinheiro que escapa.**

---

## 2. Método — LLM-judge pós-conversa

Quando uma conversa **encerra** (`status in ('closed','resolved')`), um worker assíncrono pede ao **agent-runtime** que **avalie** o transcript. O judge é um LLM barato (configurável por env, ex.: um modelo pequeno do OpenRouter) com prompt estruturado que retorna **JSON validado**:

```jsonc
{
  "quality_score": 0-100,          // qualidade da resposta (clareza, correção, tom, resolução)
  "quality_rationale": "string",   // justificativa curta (1-2 frases)
  "sentiment_score": -100..100,    // sentimento do contato ao longo do diálogo
  "csat_label": "promoter|neutral|detractor",
  "handled_by": "ai|human|mixed",  // quem conduziu majoritariamente
  "objections": [
    { "category": "price|timing|trust|competitor|feature_gap|authority|other",
      "label": "string",           // rótulo legível
      "excerpt": "string",         // citação curta do contato
      "resolved": true|false }     // a objeção foi contornada na conversa?
  ]
}
```

- **Determinismo:** `temperature` baixa + schema de saída forçado (Pydantic/JSON mode). Saída inválida → descarta a avaliação (não persiste lixo) e loga.
- **Custo:** a chamada do judge grava `llm_usage_logs(request_type='evaluation')` sob RLS do workspace — separada do gasto de produção e do `is_test` do playground. Aparece no custo de IA como linha própria.
- **Privacidade:** o judge roda dentro do agent-runtime (já opera dados do workspace sob RLS). Persistimos **score + rótulos + excerto curto** — não o transcript inteiro. Logs com PII masking (já existente em `@hm/logger`).
- **Taxonomia de objeção:** vocabulário controlado fixo no MVP (acima). Customização por workspace fica para fase futura.

---

## 3. Schema (resumo; autoritativo em `packages/db`)

Duas tabelas novas, **workspace-scoped → RLS + `RLS_TABLES`**.

```sql
CREATE TABLE conversation_evaluations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id    uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id           uuid REFERENCES agents(id) ON DELETE SET NULL,     -- agente IA que atuou
  primary_member_id  uuid REFERENCES members(id) ON DELETE SET NULL,    -- atendente humano
  handled_by         text NOT NULL CHECK (handled_by IN ('ai','human','mixed')),
  quality_score      smallint NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  quality_rationale  text,
  sentiment_score    smallint CHECK (sentiment_score BETWEEN -100 AND 100),
  csat_label         text CHECK (csat_label IN ('promoter','neutral','detractor')),
  judge_model        text NOT NULL,
  judge_cost_usd     numeric(12,6) NOT NULL DEFAULT 0,
  evaluated_at       timestamptz NOT NULL DEFAULT now(),
  raw                jsonb NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id)                                              -- 1 avaliação/conversa (idempotência)
);
CREATE INDEX idx_conv_eval_ws_evaluated ON conversation_evaluations(workspace_id, evaluated_at DESC);
CREATE INDEX idx_conv_eval_ws_agent     ON conversation_evaluations(workspace_id, agent_id);
CREATE INDEX idx_conv_eval_ws_member    ON conversation_evaluations(workspace_id, primary_member_id);

CREATE TABLE objections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  evaluation_id   uuid NOT NULL REFERENCES conversation_evaluations(id) ON DELETE CASCADE,
  category        text NOT NULL,        -- vocab controlado (§2)
  label           text NOT NULL,
  excerpt         text,
  resolved        boolean NOT NULL DEFAULT false,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_objections_ws_category ON objections(workspace_id, category);
CREATE INDEX idx_objections_ws_occurred ON objections(workspace_id, occurred_at DESC);
```

---

## 4. Gatilho — worker por polling (idempotente)

Sem tocar o caminho de fechamento de conversa. Um **scheduler worker** (padrão `dashboard-refresh`/`followup`) roda a cada N minutos:

1. Seleciona conversas `status in ('closed','resolved')` **sem** linha em `conversation_evaluations` (LEFT JOIN), nas últimas X horas, lote pequeno.
2. Para cada uma: `POST /internal/evaluate { workspace_id, conversation_id }` no agent-runtime.
3. Persiste `conversation_evaluations` (upsert por `conversation_id`) + N `objections`. Falha do judge → não persiste, tenta no próximo tick (backoff por contagem).

Idempotência via `UNIQUE(conversation_id)`. Reprocessamento manual é possível deletando a avaliação.

---

## 5. Métricas no dashboard

Server-driven (mesmo mecanismo da Onda A). Novas métricas em `services/dashboard/definitions.ts`:

| Métrica | Tipo | Roles | Fonte |
|---|---|---|---|
| `qualidade_resposta_media` | stat | SUP_RO | avg(quality_score) 30d |
| `qualidade_por_agente` | table | SUP/ADMIN | avg(quality_score) GROUP BY agent_id |
| `qualidade_por_atendente` | table | SUP/ADMIN | avg(quality_score) GROUP BY primary_member_id |
| `satisfacao_media` (CSAT) | stat | SUP_RO | avg(sentiment) / distribuição promoter-neutral-detractor 30d |
| `objecoes_rankeadas` | table | SUP_UP | objections GROUP BY category — count + %resolvida, top N. Drill-down: drawer com exemplos (excerpt) |

Categoria visual: qualidade → `agentes`; CSAT → `atendimento`; objeções → `negocio`. Drill-down em **drawer** (nunca modal — [`UX_PRINCIPLES.md`](../UX_PRINCIPLES.md) §2.3).

---

## 6. Edge cases

- **Conversa muito curta / sem conteúdo do contato** → judge retorna `quality_score` mas `sentiment`/objeções podem vir vazios; CSAT `null` não polui média.
- **Conversa só-IA vs só-humano vs mista** → `handled_by` separa; rankings por agente e por atendente coexistem sem dupla-contagem (cada conversa tem 1 avaliação).
- **Saída do judge inválida** (JSON quebrado) → descarta, reprocessa; nunca persiste parcial.
- **Custo** → cada avaliação tem custo; o worker processa em lote pequeno e respeita um teto diário opcional por workspace (futuro). Custo aparece em `llm_usage_logs`.
- **Reabertura de conversa** → se reabre e fecha de novo, a avaliação existente é sobrescrita (upsert) na próxima passada (opcional; MVP mantém a primeira).
- **PII** → persistir excerto curto, não transcript; respeitar LGPD delete (cascade em conversation/workspace já cobre).

---

## 7. Não-objetivos MVP

- ❌ Survey de CSAT ativo ao contato (WhatsApp) — método escolhido é sentimento.
- ❌ Taxonomia de objeção customizável por workspace — vocab fixo no MVP.
- ❌ Avaliação em tempo real durante a conversa — é pós-encerramento.
- ❌ Coaching automático / sugestão de resposta a partir da avaliação — fase futura.

---

> Princípio fechado: **medir qualidade e objeção transforma o dashboard de "quanto fizemos" em "o que melhorar".** O LLM-judge dá esse sinal sem pedir nada ao cliente final.
