# Runbook — Gestão da policy de agentes por workspace (`workspace_agent_policies`)

> **Para quem:** super-admin de plataforma do `tagix` (Highermind v2) definindo, por workspace, o que os agentes IA podem usar (modelos, features LangGraph, limites de custo).
> **Por quê:** habilitar/restringir capacidades por plano ou por cliente, conter custo, ou responder a abuso/spike de gasto — **sem mexer em código** (este é o entregável da F2.5).
> **Onde:** painel **Super-admin → Políticas** (`/platform/policies`, F25-S07), sobre a API `GET/PUT /platform/workspaces/:workspaceId/agent-policy` (F25-S03). Enforcement em runtime é feito pela F2 (não por este painel).

> ⚠️ **Os caps são fronteiras de custo e de comportamento.** Afrouxar `max_monthly_cost_usd`, ligar `allow_agent_conversions` ou adicionar um modelo caro a `allowed_models` tem efeito imediato no gasto do tenant. Toda mudança é auditada (`audit_logs`, `updated_by` = você).

---

## 0. Modelo mental

`workspace_agent_policies` é **1:1 com o workspace** (PK = `workspace_id`). A F2 valida cada agente/execução contra ela em runtime; este painel é a UI de super-admin que a define. Acesso é cross-workspace (sem RLS de tenant) — o guard `requirePlatformAdmin` é a fronteira; as queries setam o `workspace_id` alvo explicitamente.

Se a policy não existir no primeiro `GET`, a API cria uma **default** (valores conservadores do schema) — você edita a partir dela.

---

## 1. Glossário dos campos

### Modelos
| Campo | Efeito |
|---|---|
| `allowed_models` (text[]) | slugs OpenRouter que os agentes deste workspace podem usar. **Vazio = herda a allow-list do plano.** A API só aceita slugs presentes na **whitelist ativa** (`llm_models_whitelist.is_active = true`). |
| `default_chat_model` | modelo pré-selecionado ao criar um agente novo. Deve pertencer a `allowed_models` (a API valida). |

### Features LangGraph (flags booleanas)
| Flag | O que libera | Cuidado |
|---|---|---|
| `allow_streaming` | resposta token-a-token | barato; geralmente ON. |
| `allow_interrupts` | human-in-the-loop (pausar p/ aprovação) | necessário p/ aprovação de conversões. |
| `allow_parallel_tools` | múltiplas tool calls em paralelo | mais rápido; pode multiplicar custo por iteração. |
| `allow_vision` | input de imagem | exige modelo com `supports_vision`; **mais caro por token**. |
| `allow_transcription` | áudio → texto (Whisper/OpenAI direct) | custo por minuto de áudio. |
| `allow_persistent_checkpoints` | memória durável do grafo | usa storage; geralmente ON. |
| `allow_agent_conversions` | o agente pode registrar `conversion_events` | **envolve $$/negócio** — OFF por default. |
| `agent_conversion_require_approval` | se conversões ON, exige confirmação humana (interrupt) | mantenha ON salvo confiança total no agente. |

### Caps (limites operacionais — não-negativos; a API rejeita valores < 0)
| Cap | O que limita | Armadilha de custo |
|---|---|---|
| `max_iterations` | passos do grafo por invocação | loop alto = mais chamadas LLM por mensagem. |
| `max_tools_per_agent` | nº de tools por agente | mais tools = prompt maior = mais tokens. |
| `max_tokens_per_call` | teto de tokens por chamada | **o multiplicador direto de custo**; subir é o jeito mais rápido de estourar gasto. |
| `max_monthly_cost_usd` | teto de gasto-mês do workspace (NULL = sem cap) | a barreira financeira primária. NULL é arriscado em conta de cliente. |
| `max_daily_invocations` | invocações/dia (NULL = sem cap) | barra abuso/loop; bom ter em planos baixos. |
| `allowed_tool_categories` (text[]) | subset de `{database, http, workflow, calendar, knowledge}` | restringe o que as tools podem tocar; menos = mais seguro. |

---

## 2. Aplicar uma mudança com segurança

1. **Super-admin → Políticas** → selecione o workspace alvo.
2. Edite na seção certa (modelos / features / caps). `allowed_models` é multi-select da whitelist **ativa** — não há como escolher um modelo desligado na plataforma.
3. **Salve.** A API valida (`allowed_models ⊆ whitelist ativa`; `default_chat_model ∈ allowed_models`; caps ≥ 0), grava `updated_by` = você e registra em `audit_logs`.

### Afrouxar (mais capacidade — fazer com cuidado)
- Suba `max_monthly_cost_usd` / `max_tokens_per_call` em **incrementos**, observando `llm_usage_logs` por alguns dias antes de subir mais.
- Ao ligar `allow_vision`/`allow_transcription`, confirme que `allowed_models` tem um modelo que suporta o recurso, e avise o cliente do impacto no custo.
- Ao ligar `allow_agent_conversions`, deixe `agent_conversion_require_approval = ON` salvo decisão explícita do contrário.

### Restringir (conter custo/abuso — efeito imediato)
- Para frear um spike: **baixe `max_monthly_cost_usd`** e/ou `max_daily_invocations`. O enforcement da F2 passa a barrar novas invocações que excedam.
- Remover um modelo de `allowed_models` que esteja **em uso** por um agente: o painel avisa do impacto (§2.9). Agentes que apontam para o modelo removido deixam de poder usá-lo na próxima execução — prefira migrar o agente para um modelo permitido antes.

---

## 3. Verificação (critério de "resolvido")

1. **Persistiu** — reabra a policy do workspace; os valores refletem a mudança.
2. **Auditado** — em **Auditoria** (ou `audit_logs`), há a entrada com `action` da policy, `updated_by` = você, e o `workspace_id` alvo.
3. **Enforcement ativo** — dispare uma execução de agente no workspace e confirme o comportamento esperado (ex.: cap baixo → execução é barrada; modelo removido → não selecionável). Inspeção rápida em prod:

```bash
export COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
psqlc() { $COMPOSE exec -T postgres psql -U "$PG_USER" -d highermind "$@"; }
psqlc -c "select allowed_models, default_chat_model, max_monthly_cost_usd,
                 max_tokens_per_call, updated_by, updated_at
          from workspace_agent_policies where workspace_id = 'WORKSPACE_UUID';"
```

---

## 4. Rollback

A policy não tem histórico versionado no schema; o rollback é **reaplicar os valores anteriores** (que você anotou antes de mudar) pelo mesmo painel. A trilha em `audit_logs` registra o antes/depois nas `metadata` da entrada — use-a para reconstruir o estado anterior se necessário.

> Antes de uma mudança grande, anote o estado atual (print da policy ou o `SELECT` do §3). Não há "desfazer" automático.

---

## 5. Armadilhas comuns

- **Custo silencioso:** `max_tokens_per_call` alto + `max_iterations` alto + `allow_parallel_tools` ON multiplicam gasto por mensagem. Olhe os três juntos.
- **`max_monthly_cost_usd = NULL` em conta de cliente:** sem teto. Sempre defina um cap em workspaces de cliente.
- **Modelo fora da whitelist:** se um agente referencia um slug que saiu da whitelist ativa (super-admin desligou em Modelos), ele não roda — a fonte da verdade é a whitelist global, não só a policy.
- **`default_chat_model` órfão:** se você remover de `allowed_models` o slug que era o default, a API rejeita o save até você corrigir o default.
