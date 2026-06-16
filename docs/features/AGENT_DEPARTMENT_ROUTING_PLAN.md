# Roteamento Agente-de-IA ↔ Departamento + Handoff Multi-Agente — Levantamento & Plano

> **Data:** 2026-06-15
> **Origem:** pedido do founder — no LiveChat, o owner deve poder definir **qual departamento cada agente de IA atende** (N:N — um agente pode atender vários departamentos); quando um departamento tem múltiplos agentes, eles devem poder **alternar entre si** de forma **autônoma (via prompt)** e **manual (no cockpit)**.
> **Decisão travada:** vínculo **N:N** (um agente → vários departamentos).
> **Método:** auditoria do código atual, verificada em arquivo. Status: **levantamento + plano para aprovação**; decomposição em slots vem **após** aprovação.

---

## 1. TL;DR

A fundação existe: **departamentos/teams** (F8), **conversa carrega `department_id`/`team_id`/`agent_id`/`ai_mode`**, **toggle de IA on/off/paused** no cockpit (F30), **runtime de agentes** (F2) com resolução de agente por conversa e **handoff IA→humano** com contexto de retomada.

Faltam **4 peças** para a feature:
1. **Vínculo agente↔departamento** (não existe — `agents` não tem nenhuma referência a departamento).
2. **Resolução do agente por departamento** (hoje a conversa resolve para um agente único/default do workspace, sem olhar o departamento).
3. **Transferência autônoma IA→IA via prompt** (não existe — só há IA→humano).
4. **Transferência manual no cockpit** (não existe — o header só liga/desliga a IA, e nem mostra qual agente está atendendo).

Nenhuma dessas depende de infra externa da Meta — é 100% trabalho de código nosso.

---

## 2. Levantamento — o que JÁ existe

| Capacidade | Estado | Evidência |
|---|---|---|
| Departamentos + teams + membros | ✅ | `packages/db/src/schema/org.ts` (`departments`, `teams`, `team_members`) |
| Conversa com `department_id` / `team_id` / `agent_id` / `ai_mode` | ✅ | `packages/db/src/schema/conversations.ts` |
| Toggle IA on/off/paused (API + cockpit) | ✅ | `apps/api/src/routes/conversations/state.ts` (`/ai-mode`); `ConversationHeader.tsx` |
| Handoff **IA→humano** (auto-pausa no takeover + retomada consciente) | ✅ | `messages.ts` (`human_takeover`); `agent-runtime/app/nodes/build_prompt.py` |
| Runtime de agentes (LangGraph) + worker + métricas | ✅ | `apps/workers/src/agents/*`; `apps/agent-runtime/*` |
| **Resolução do agente da conversa** | ✅ (sem dept) | `store.loadContext(workspaceId, trigger)` em `apps/workers/src/agents/run.ts:277` resolve `ctx.agentId` a partir da conversa |
| Disparo da IA no inbound quando `ai_mode='on'` | ⚠️ | `inbound/db-ports.ts:499` enfileira gatilho em `hm.q.flows`; o agente é resolvido depois, em `loadContext` (o comentário "STUB" em `db-ports.ts:225` é sobre o **shape** do envelope, não sobre a resolução) |
| Tools internas de agente (registry + authz) | ✅ | `apps/api/src/internal/tools/` (`registry.ts`, `router.ts`, `auth.ts`, `*-handlers.ts`) |
| Flag `agents.allow_handoff` | ✅ (não usada p/ IA→IA) | `packages/db/src/schema/agents.ts:56` |

---

## 3. Levantamento — o que FALTA (lacunas)

### L1 — Vínculo agente ↔ departamento 🔴
`agents` só tem `enabled_channel_ids`. Não há nenhuma forma de dizer "o agente X atende os departamentos A e B". Sem isso, nada do resto se sustenta.

### L2 — Resolução do agente por departamento 🔴
`loadContext` resolve o agente da conversa (provavelmente `conversation.agent_id` → fallback default do workspace). Não há lógica "pegue o agente de entrada do departamento desta conversa". Também não há regra de qual agente engaja a **primeira** mensagem quando o departamento tem vários.

### L3 — Transferência autônoma IA→IA 🔴
Não existe tool que permita ao agente passar a conversa para outro agente, nem diretriz de prompt que liste os pares disponíveis. O `allow_handoff` existe mas só conceitualmente. O encanamento de contexto de handoff (`build_prompt.py`) hoje só cobre IA→humano.

### L4 — Transferência manual no cockpit 🔴
O `ConversationHeader`/cockpit liga/desliga a IA, mas **não mostra qual agente está atendendo** nem permite **trocar** o agente. Não há endpoint `POST /conversations/:id/agent`.

### L5 — UI de configuração (owner) 🟠
Não há onde o owner associe agentes a departamentos (nem no editor de agente, nem na `DepartmentsSection`).

---

## 4. Design proposto

### 4.1 Schema (resolve L1)
Tabela de junção **N:N** `agent_departments`:
- `agent_id`, `department_id`, `workspace_id` (denormalizado p/ RLS direta, padrão `team_members`/`contact_tags`).
- `is_default boolean` — marca o **agente de entrada DAQUELE departamento** (quem atende a primeira mensagem). Índice parcial único: no máximo 1 default por departamento.
- PK `(agent_id, department_id)`; RLS por `workspace_id`.

> **Decisão aberta D1 (ver §6):** com N:N, um agente pode atender depts diferentes com necessidades diferentes. v1 recomendado = **um único `system_prompt` por agente** + contexto do departamento injetado em runtime. Override de prompt por (agente, dept) fica para depois, se necessário.

### 4.2 Resolução por departamento (resolve L2)
Estender a resolução em `loadContext` (e/ou um passo antes do `runAgent`):
1. Se `conversation.agent_id` já está setado → usa ele (sticky; transferências persistem aqui).
2. Senão, resolve pelo `conversation.department_id` → **agente default daquele departamento** (`agent_departments.is_default`).
3. Fallback: sem departamento ou sem default → comportamento atual (default do workspace).
4. **Persiste** o agente resolvido em `conversation.agent_id` (sticky) para turnos seguintes e para o cockpit exibir.

> **Decisão aberta D2 (ver §6):** quando o dept tem vários agentes e nenhum default, o engate inicial usa **agente default designado** (recomendado) vs **rodízio/menos-ocupado** (espelhando o auto-assign de humanos).

### 4.3 Transferência autônoma via prompt (resolve L3)
- **Nova tool interna `transfer_to_agent`** (em `apps/api/src/internal/tools/`, seguindo o padrão de `calendar-handlers`/`workflow-handlers` + `registry.ts`). Handler: valida o alvo permitido → grava `conversation.agent_id` = alvo → registra log/evento de handoff → re-engaja (enfileira run do novo agente). Idempotente.
- **Authz de alvo:** o agente só transfere para agentes que compartilham ao menos um departamento com ele (pares) — e, se configurado, para agentes de outro dept (escalonamento). Ver D3.
- **Diretriz de prompt:** o `build_prompt` do runtime injeta, quando `agent.allow_handoff=true`, a lista de pares disponíveis + quando transferir (ex.: "se o assunto for cobrança, transfira para o agente Financeiro"). O LLM decide e chama a tool.
- **Contexto IA→IA:** generalizar o handoff de `build_prompt.py` para também rotular turnos de "outro agente de IA" (hoje só rotula `human`), para o agente que assume entender o histórico.

### 4.4 Transferência manual no cockpit (resolve L4)
- **Endpoint `POST /api/conversations/:id/agent`** `{ agentId }` — grava `conversation.agent_id`, garante `ai_mode='on'`, registra handoff, re-engaja. Gated por permissão (`conversation.ai_mode` ou nova `conversation.assign_agent`). AGENT só nas suas; guard de visibilidade por-conversa (padrão S07.1). Emite `conversation:agent_changed` (novo evento de socket).
- **Cockpit/Header:** mostrar o **agente atual** (hoje só "IA ativa/off") + dropdown com os agentes elegíveis para o(s) departamento(s) da conversa → on change chama o endpoint.

### 4.5 UI de configuração do owner (resolve L5)
- **Editor de agente** (settings): multi-select de departamentos + marcar "agente de entrada" por departamento (lado natural da N:N: gerencia-se a partir do agente).
- **`DepartmentsSection`:** listar (read) os agentes de cada departamento, com atalho para gerenciar.

---

## 5. Decomposição preliminar em slots (para validar — detalhe vem no /hm-tasks)

Proposta de fase **F34 — Roteamento Agente↔Departamento & Handoff Multi-Agente** (F32/F33 já foram usadas pelo Flow Builder).

**Onda A — fundação (schema + config)**
- **S01** `agent_departments` (schema + migration + RLS + repo) `[db]`
- **S02** Editor de agente: multi-select de departamentos + default-por-dept (API + UI settings) `[api+web]` — dep: S01

**Onda B — resolução**
- **S03** Resolução department-aware em `loadContext` (+ persist sticky + fallback + testes) `[workers]` — dep: S01

**Onda C — transferência**
- **S04** Transferência **manual**: endpoint `/conversations/:id/agent` + evento socket + dropdown no cockpit + exibir agente atual `[api+web]` — dep: S01 (S03 ajuda)
- **S05** Transferência **autônoma**: tool `transfer_to_agent` + registry + authz de alvo (pares do dept / escalonamento) `[api]` — dep: S01
- **S06** Runtime: diretriz de prompt listando pares + contexto de handoff IA→IA `[agent-runtime]` — dep: S01 (S05 p/ contrato da tool)

**Onda D — fechamento**
- **S07** e2e (engaja → transfere autônomo → transfere manual) + testes + docs (LIVECHAT_OPS / AGENTS) `[qa]` — dep: C

Dependência raiz: **S01 destrava tudo**. Ondas B e C podem correr em paralelo após S01.

---

## 6. Decisões abertas (confirmar na aprovação)

- **D1 — Prompt por departamento:** v1 = um `system_prompt` por agente + contexto do dept em runtime *(recomendado)* vs prompt/override por (agente, dept) já agora.
- **D2 — Agente de entrada quando o dept tem vários:** agente default designado por dept *(recomendado)* vs rodízio/menos-ocupado.
- **D3 — Escopo da transferência autônoma:** dentro do dept + escalonar p/ outro dept quando configurado *(recomendado)* vs só dentro do mesmo dept.
- **D4 — Permissão da troca manual:** reusar `conversation.ai_mode` vs criar `conversation.assign_agent` dedicada *(recomendado p/ auditoria mais limpa)*.
