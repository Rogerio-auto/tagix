# Roteamento Agente-de-IA ↔ Departamento + Handoff Multi-Agente — Plano & Entrega

> **Data:** 2026-06-15 (plano) · **Entregue:** 2026-06-16 (F34 S01–S07)
> **Origem:** pedido do founder — no LiveChat, o owner deve poder definir **qual departamento cada agente de IA atende** (N:N — um agente pode atender vários departamentos); quando um departamento tem múltiplos agentes, eles devem poder **alternar entre si** de forma **autônoma (via prompt)** e **manual (no cockpit)**.
> **Decisão travada:** vínculo **N:N** (um agente → vários departamentos).
> **Status:** ✅ **IMPLEMENTADO** — fase **F34** decomposta e entregue (S01–S07). As lacunas L1–L5 estão fechadas e as decisões abertas D1–D4 foram travadas (vide §3 e §6). Docs de referência: `AGENTS_LANGGRAPH.md §7.6`, `LIVECHAT_OPS.md §2.1`, `PERMISSIONS.md §2.1`.

---

## 0. Estado de entrega (F34)

| Slot | Escopo | Estado |
|---|---|---|
| **S01** | `agent_departments` (schema + migration + RLS + `agentDepartmentsRepo`) | ✅ |
| **S02** | Editor de agente: multi-select de departamentos + default-por-dept (API + UI settings) | ✅ |
| **S03** | Resolução department-aware em `loadContext` (+ persist sticky + fallback) | ✅ |
| **S04** | Transferência **manual**: `POST/GET /api/conversations/:id/agent` + socket `conversation:agent_changed` + `AgentSelector` no cockpit | ✅ |
| **S05** | Transferência **autônoma**: tool `transfer_to_agent` (Node) + authz de alvo same-dept | ✅ |
| **S06** | Runtime: diretriz de prompt com pares + contexto de handoff IA→IA (`ai_other`) | ✅ |
| **S07** | e2e (config → resolução por dept → troca manual) + consolidação de docs | ✅ |

---

## 1. TL;DR

A fundação existe: **departamentos/teams** (F8), **conversa carrega `department_id`/`team_id`/`agent_id`/`ai_mode`**, **toggle de IA on/off/paused** no cockpit (F30), **runtime de agentes** (F2) com resolução de agente por conversa e **handoff IA→humano** com contexto de retomada.

Faltavam **4 peças** — **todas entregues na F34** (vide §0):
1. **Vínculo agente↔departamento** — ✅ tabela N:N `agent_departments` (S01).
2. **Resolução do agente por departamento** — ✅ `loadContext` department-aware + sticky (S03).
3. **Transferência autônoma IA→IA via prompt** — ✅ tool `transfer_to_agent` + diretriz + contexto `ai_other` (S05/S06).
4. **Transferência manual no cockpit** — ✅ `GET/POST /api/conversations/:id/agent` + `AgentSelector` (S04).

Nenhuma dessas dependeu de infra externa da Meta — foi 100% trabalho de código nosso.

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

## 3. Lacunas — diagnóstico original e como foram fechadas

### L1 — Vínculo agente ↔ departamento ✅ (S01)
Diagnóstico: `agents` só tinha `enabled_channel_ids`; sem forma de dizer "o agente X atende os depts A e B".
**Entregue:** tabela N:N `agent_departments` (RLS por `workspace_id`, `is_default` = agente de entrada do dept, índice parcial único de 1 default/dept) + `agentDepartmentsRepo`.

### L2 — Resolução do agente por departamento ✅ (S03)
Diagnóstico: `loadContext` resolvia para o agente único/default do workspace, sem olhar o dept.
**Entregue:** resolução department-aware em `loadContext` — `conversation.agent_id` sticky → default do dept (`is_default`) → fallback workspace, com **persist** do agente resolvido (sticky). Detalhe em `AGENTS_LANGGRAPH.md §7.6`.

### L3 — Transferência autônoma IA→IA ✅ (S05 + S06)
Diagnóstico: não havia tool de handoff IA→IA, nem diretriz de prompt, nem rótulo de "outro agente de IA" no contexto.
**Entregue:** tool `transfer_to_agent` (Node single-source-of-truth, authz de alvo same-dept, idempotente) + diretriz de prompt com lista de pares (`build_prompt`, gated por `allow_handoff`) + rótulo de contexto `ai_other` ("Outro agente de IA").

### L4 — Transferência manual no cockpit ✅ (S04)
Diagnóstico: o cockpit ligava/desligava a IA mas não mostrava nem trocava o agente; faltava o endpoint.
**Entregue:** `GET/POST /api/conversations/:id/agent` (gated por `conversation.assign_agent`, guard de visibilidade por-conversa, 404-antes-de-403) + socket `conversation:agent_changed` + `AgentSelector` no `ContactInfoPanel`. Detalhe em `LIVECHAT_OPS.md §2.1`.

### L5 — UI de configuração (owner) ✅ (S02)
Diagnóstico: não havia onde o owner associasse agentes a departamentos.
**Entregue:** editor de agente (wizard 4º passo "Departamentos" + ConfigTab) aceita/retorna `departments: { departmentId, isDefault }[]`; API em `apps/api/src/routes/agents/crud.ts`.

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

## 5. Decomposição em slots (executada — vide §0 para o estado de entrega)

Fase **F34 — Roteamento Agente↔Departamento & Handoff Multi-Agente** (F32/F33 já foram usadas pelo Flow Builder). Todos os slots abaixo foram entregues (S01–S07).

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

## 6. Decisões travadas (implementadas na F34)

- **D1 — Prompt por departamento:** ✅ **travada no recomendado** — um `system_prompt` por agente + contexto do dept injetado em runtime. Override de prompt por (agente, dept) fica para depois, se necessário.
- **D2 — Agente de entrada quando o dept tem vários:** ✅ **travada no recomendado** — **agente default designado por dept** (`agent_departments.is_default`). Rodízio/menos-ocupado não foi adotado para o engate inicial da IA (segue espelhando o auto-assign de humanos só na distribuição de conversas, não na escolha do agente de IA).
- **D3 — Escopo da transferência autônoma:** ✅ **travada (conservadora):** **só dentro do mesmo departamento** (authz de alvo `areAgentsInSameDepartment`). O escalonamento cross-dept fica como TODO honesto no handler até existir flag de departamento-destino — sem afrouxar a authz agora.
- **D4 — Permissão da troca manual:** ✅ **travada no recomendado** — permissão dedicada **`conversation.assign_agent`** (auditoria mais limpa que reusar `conversation.ai_mode`). Registrada em `PERMISSIONS.md §2.1`.
