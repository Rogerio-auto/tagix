# AGENTS_LANGGRAPH — Highermind v2

> **Documento:** Sistema de agentes IA do v2 usando **LangGraph Python** como microsserviço dedicado, **OpenRouter** como roteador LLM, e **super-admin** como source-of-truth das policies por workspace.
> **Versão:** 0.2 — pivotado de LangGraph.js para LangGraph Python
> **Alvo:** Substituir o runtime custom de 702 linhas (`agents-runtime.service.ts`) do v1 por um state graph Python, isolado em container próprio, governado por policy de plataforma.

---

## 1. Contexto da decisão

### 1.1 O que existe no v1 (confirmado pelo explorer)

O backend do v1 **não usa LangChain** — apesar da expectativa do Rogério. O `backend/package.json` tem apenas:

- `openai: ^6.7.0` (SDK puro)
- `zod` (para validação de schemas)

O sistema implementa um framework **tipo LangChain feito à mão** em `backend/src/services/agents-runtime.service.ts` (702 linhas):

- Loop manual com `client.chat.completions.create()`
- Detecção de `finish_reason === 'tool_calls'` em até 5 iterações
- Execução paralela de tools via `Promise.all`
- Context histórico em Redis (TTL 1h, max 20 turnos)
- Construção manual de system prompt (`buildPrompt`)
- Sem streaming, sem interrupt, sem human-in-the-loop, sem checkpoint persistente

### 1.2 Por que LangGraph **Python** (não JS, não custom)

| Opção | Pros | Contras | Veredito |
|---|---|---|---|
| **Manter custom (refatorado)** | Zero deps, controle total | Reinventar checkpoint, streaming, interrupt, retry sofisticado | ❌ Custo de manter > valor |
| **LangChain (não-Graph)** | Ecossistema vasto | Abstrações vazadas, runtime pesado, deprecated para workflows | ❌ Wrong tool |
| **LangGraph.js** | TypeScript end-to-end, sem polyglot | Ecossistema Node ainda muito atrás do Python: menos tools, menos integrações de provider, observability (LangSmith) Python-first, eval tooling Python-first, comunidade muito menor, releases atrasados | ❌ Trade-off ruim |
| **LangGraph Python** (em container dedicado) | Ecossistema maduro: tools, integrações de provider, eval, LangSmith, comunidade, releases sincronizados. Polyglot é o trade-off explícito; isolado em `apps/agent-runtime/` | Polyglot: serviço Python separado, infra extra, IPC | ✅ **Adotado (ADR-006 + ADR-023)** |
| **Vercel AI SDK** | Bonito, streaming, multi-provider | Não é workflow framework; só camada de chat completion | ❌ Resolve outro problema |

**Decisão final:** LangGraph Python + LangServe (FastAPI) + PostgresSaver (checkpoints no mesmo Postgres) + **OpenRouter como roteador LLM único** (ADR-022). Node continua dono de API/workers/UI/canais; agent runtime é polyglot mas isolado.

### 1.3 O que NÃO migra para LangGraph

O Flow Builder do v1 (engine custom em `flow-engine.service.ts`) **NÃO usa LangGraph** no v2. São coisas diferentes:

- **Flow Builder** = workflow visual configurado por humano. Determinístico, sem LLM no controle. Mantém engine custom **em Node** (refatorada e limpa).
- **Agentes** = LLM com tool calling controlado pela LLM. **Aqui** é onde LangGraph Python entra.

Os dois conversam: um Flow pode invocar um agente (handler `ai_action` do flow); um agente pode marcar um deal pra mover stage (que dispara um flow).

---

## 2. Topologia do agent-runtime

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Node API (Express, port 3001)                                              │
│  - resolve workspace_agent_policy (do Postgres)                             │
│  - resolve agent config (DB) + monta payload                                │
│  - hard-cap enforcement (pre-call): policy.max_monthly_cost_usd vs sum logs │
│  - POST agent-runtime:8001/agents/{agentId}/run  (SSE)                      │
│  - relay SSE → frontend (socket.io ou EventSource pass-through)             │
│  - expõe /internal/tools/{toolKey} para callback Python                     │
└──────────────────────┬─────────────────────────────────────────────────────┘
                       │  HTTP + SSE (Bearer AGENT_RUNTIME_TOKEN)
                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  agent-runtime (FastAPI + LangServe, Python 3.13, port 8001)                │
│  POST /agents/{agentId}/run        → stream events                          │
│  POST /agents/{agentId}/resume     → para interrupts                        │
│  GET  /healthz                                                              │
│  GET  /openapi.json                                                         │
│                                                                             │
│  Aplica policy_snapshot recebido na requisição (filtra tools / modelo /     │
│  max_iterations / etc.) antes de invocar o grafo.                           │
│                                                                             │
│  Grafo: load_context → build_prompt → call_model → tool_dispatch → finalize │
│  Checkpointer: langgraph.checkpoint.postgres.PostgresSaver                  │
│  LLM: OpenRouter via httpx (streaming + tool calling)                       │
└─────┬───────────────────────────────────────────────┬──────────────────────┘
      │                                                │
      │ asyncpg (workspace RLS)                        │ httpx callback
      ▼                                                ▼
┌──────────┐                                  ┌──────────────────────────────┐
│ Postgres │                                  │  Node /internal/tools/*       │
│  (mesmo  │                                  │  - transfer_to_human          │
│   PG do  │                                  │  - mark_resolved              │
│  Highm)  │                                  │  - trigger_flow               │
│ + ckpt   │                                  │  - schedule_event             │
│ tables   │                                  │  - move_deal_stage            │
└──────────┘                                  │  - change_conversation_status │
                                              └──────────────────────────────┘
```

Dois containers Python idênticos (`agent-runtime` réplicas=2 atrás de DNS Docker Compose `agent-runtime:8001`). Stateless — escalável horizontalmente.

---

## 3. Conceitos do LangGraph aplicados a Highermind

### 3.1 State (Python TypedDict)

O `AgentState` é o objeto que flui pelo grafo. Imutável entre nodes (cada node retorna um patch).

```python
# apps/agent-runtime/app/types.py
from typing import TypedDict, Optional, Literal
from pydantic import BaseModel, Field

class ChatMessage(BaseModel):
    role: Literal['system', 'user', 'assistant', 'tool']
    content: Optional[str] = None
    tool_calls: Optional[list[dict]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None

class PolicySnapshot(BaseModel):
    """Resolvido pelo Node antes da chamada; passado em todo request."""
    allowed_models: list[str]
    allow_streaming: bool
    allow_interrupts: bool
    allow_parallel_tools: bool
    allow_vision: bool
    allow_transcription: bool
    max_iterations: int
    max_tokens_per_call: int
    max_tools_per_agent: int
    allowed_tool_categories: list[str]
    remaining_monthly_budget_usd: Optional[float]  # None = sem cap

class AgentState(TypedDict):
    # identidade
    workspace_id: str
    agent_id: str
    conversation_id: Optional[str]
    contact_id: Optional[str]
    thread_id: str

    # policy (snapshot resolvido pelo Node)
    policy: PolicySnapshot

    # I/O
    user_input: str
    messages: list[ChatMessage]

    # contexto resolvido
    agent: dict       # AgentConfig
    contact: Optional[dict]
    conversation: Optional[dict]
    tools: list[dict] # ToolDescriptor filtrados por policy

    # controle de loop
    iteration: int
    should_handoff: bool
    handoff_reason: Optional[str]

    # saída
    final_reply: Optional[str]
    usage: dict       # { prompt_tokens, completion_tokens, total_cost_usd }

    # diagnóstico
    tool_calls_executed: list[dict]
    errors: list[str]
```

### 3.2 Nodes (Python async functions)

Cada node é uma `async def (state: AgentState) -> dict` que retorna o patch.

```python
# apps/agent-runtime/app/nodes/load_context.py
async def load_context_node(state: AgentState) -> dict:
    pg = get_pg()  # asyncpg pool com workspace context

    async with pg.acquire() as conn:
        await conn.execute("SET LOCAL app.workspace_id = $1", state["workspace_id"])

        agent = await load_agent(conn, state["agent_id"])
        contact = await load_contact(conn, state["contact_id"]) if state["contact_id"] else None
        conversation = await load_conversation(conn, state["conversation_id"]) if state["conversation_id"] else None
        # tools já chegam filtradas pelo Node aplicando policy + agent_tools.is_enabled
        tools = state["tools"]

    return { "agent": agent, "contact": contact, "conversation": conversation }
```

### 3.3 Conditional edges

```python
def should_continue_loop(state: AgentState) -> Literal['tool_dispatch', 'finalize']:
    last = state["messages"][-1] if state["messages"] else None
    if not last or last.role != 'assistant':
        return 'finalize'
    if last.tool_calls and len(last.tool_calls) > 0:
        if state["iteration"] >= state["policy"].max_iterations:
            return 'finalize'
        return 'tool_dispatch'
    return 'finalize'
```

### 3.4 Checkpointer (Postgres)

```python
# apps/agent-runtime/app/checkpoint.py
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

async def get_checkpointer():
    saver = AsyncPostgresSaver.from_conn_string(settings.DATABASE_URL)
    await saver.setup()  # idempotente; cria tabelas langgraph_* no primeiro boot
    return saver
```

State persistido a cada transição. Permite interrupt + retomar via `POST /agents/{id}/resume`.

### 3.5 Streaming (LangServe)

```python
# apps/agent-runtime/app/main.py
from fastapi import FastAPI, Depends
from langserve import add_routes

app = FastAPI(title="Highermind Agent Runtime")
add_routes(app, build_graph(), path="/lg", playground_type=None)

# Custom route com lógica de policy + auth Highermind
@app.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, req: RunAgentRequest, _=Depends(verify_token)):
    apply_policy(req.policy)  # filtra tools / modelo / etc.
    async def event_stream():
        async for chunk in graph.astream(initial_state(req), config={...}):
            yield format_sse(chunk)
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

`apply_policy()` é a barreira de segurança server-side: mesmo que o Node mandasse uma policy "torta" (não deveria), o runtime se protege.

---

## 4. Grafo do Highermind v2

```
                    ┌─────────────────┐
                    │  load_context   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  build_prompt   │
                    └────────┬────────┘
                             │
                             ▼
              ┌──────────►┌─────────────────┐
              │           │   call_model    │   (OpenRouter via httpx)
              │           └────────┬────────┘
              │                    │
              │           ┌────────▼─────────┐
              │           │ should_continue? │
              │           └────────┬─────────┘
              │                    │
              │       ┌────────────┼────────────┐
              │       │            │            │
              │   has tools    final answer  iter >= policy.max
              │       │            │            │
              │       ▼            ▼            ▼
              │   ┌───────────────┐  ┌─────────────────┐
              │   │ tool_dispatch │  │    finalize     │
              │   └───────┬───────┘  └────────┬────────┘
              │           │                   │
              └───────────┘                   ▼
                                       ┌──────────┐
                                       │   END    │
                                       └──────────┘
```

### 4.1 Nodes detalhados

| Node | Entrada | Saída | Side effects |
|---|---|---|---|
| `load_context` | workspace_id, agent_id, conversation_id, contact_id | agent, contact, conversation | SELECT em DB com `SET LOCAL app.workspace_id` |
| `build_prompt` | agent, contact, conversation, tools, messages (do checkpoint), user_input | messages (system + history + new user) | nenhum |
| `call_model` | messages, agent.model (slug OpenRouter), agent.model_params, tools.openai_schema | messages.append(assistant), usage | POST OpenRouter `/api/v1/chat/completions`; INSERT `llm_usage_logs` (com `openrouter_generation_id`, `upstream_provider`, `cost_usd`) |
| `tool_dispatch` | last assistant message com tool_calls | messages.append(N tool messages) | executa tools em paralelo se `policy.allow_parallel_tools=true`; log `tool_logs`; iteration += 1 |
| `finalize` | messages | final_reply | persist `agent_executions` (status=completed); insere outbound `messages` no Highermind |

### 4.2 Interrupt (human-in-the-loop)

Configurável **por policy**:

```python
if state["policy"].allow_interrupts:
    graph = builder.compile(checkpointer=checkpointer, interrupt_before=['tool_dispatch'])
else:
    graph = builder.compile(checkpointer=checkpointer)
```

Tools marcadas com `requires_human_approval=true` (em `handler_config`) acionam interrupt *granular* dentro do `tool_dispatch`:

```python
async def tool_dispatch_node(state):
    for tc in last.tool_calls:
        tool = registry.get(tc.name)
        if tool.config.get("requires_human_approval") and state["policy"].allow_interrupts:
            return interrupt(reason=f"Approval needed for {tc.name}", payload=tc.args)
        # ... executa
```

No MVP, esse path fica desligado por default (`allow_interrupts=false` no plano default). Super-admin liga por workspace conforme demanda.

---

## 5. OpenRouter como roteador LLM

### 5.1 Cliente

```python
# apps/agent-runtime/app/providers/openrouter.py
import httpx
from app.config import settings

class OpenRouterClient:
    def __init__(self):
        self.api_key = settings.OPENROUTER_API_KEY  # carregado de platform_secrets via Node sync, OU env direto no dev
        self.base = "https://openrouter.ai/api/v1"
        self.client = httpx.AsyncClient(timeout=120.0)

    async def chat_completion(self, *, model: str, messages: list, tools: list | None, stream: bool, **params):
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://highermind.app",  # OpenRouter recomenda; aparece em analytics deles
            "X-Title": "Highermind v2",
        }
        body = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "stream": stream,
            **params,
        }

        if stream:
            return self._stream(body, headers)
        else:
            r = await self.client.post(f"{self.base}/chat/completions", json=body, headers=headers)
            r.raise_for_status()
            return r.json()  # contém id (= openrouter_generation_id), usage, choices, provider

    async def get_generation(self, generation_id: str) -> dict:
        """Para auditoria detalhada (cost real, model real, tokens precisos)."""
        r = await self.client.get(f"{self.base}/generation?id={generation_id}",
                                  headers={"Authorization": f"Bearer {self.api_key}"})
        return r.json()
```

### 5.2 Modelos

Slug OpenRouter: `provider/model[:variant]`. Exemplos:

- `openai/gpt-4o-mini` — default barato/rápido
- `openai/gpt-4o` — capability alta
- `anthropic/claude-3.5-sonnet` — alternativa premium
- `anthropic/claude-3.5-haiku` — econômico
- `google/gemini-2.5-pro` — opcional
- `meta-llama/llama-3.3-70b-instruct` — open source via OpenRouter

`agents.model` armazena o slug. `workspace_agent_policies.allowed_models[]` controla quais o workspace pode escolher. UI do AgentCreationWizard mostra dropdown filtrado.

### 5.3 Tool calling

OpenRouter aceita o mesmo formato OpenAI (`tools: [{type:'function', function: {name, description, parameters}}]`). Modelos que não suportam tools são marcados em `llm_models_whitelist.supports_tools=false` e ficam ocultos na criação de agentes.

### 5.4 Embeddings, transcription, vision

OpenRouter **não cobre** embeddings/transcription nativamente (depende do provider). Highermind faz chamadas diretas:

- **Embeddings**: OpenAI `text-embedding-3-small` (1536 dims).
- **Transcription**: OpenAI `whisper-1`.
- **Vision**: OpenRouter cobre modelos com `supports_vision=true` (gpt-4o, claude sonnet, gemini); para upload + análise via Files API usar OpenAI direto.

Logs separados em `llm_usage_logs` com `router='openai_direct'`.

### 5.5 Custom routing (futuro)

OpenRouter suporta `provider` field para forçar/preferir providers. MVP usa default (OpenRouter decide pelo menor custo/melhor latência). Fase 2: super-admin pode setar `model_params.provider_preference` em `agents`.

---

## 6. Tools

### 6.1 Estrutura

```
apps/agent-runtime/app/tools/
├── registry.py                  # registry global; carrega no boot
├── types.py                     # ToolDescriptor, ToolContext, ToolResult
├── database/
│   ├── query_contact.py
│   ├── update_contact.py
│   ├── add_contact_tag.py
│   ├── query_conversation.py
│   └── move_deal_stage.py       # leve: UPDATE direto via asyncpg
├── knowledge/
│   └── search_kb.py             # leve: pgvector cosine search via asyncpg
├── calendar/
│   ├── list_calendars.py
│   ├── get_available_slots.py
│   └── schedule_event.py        # callback HTTP para Node (cria event + notifica)
├── workflow/
│   ├── transfer_to_human.py     # callback HTTP para Node
│   ├── transfer_to_agent.py     # callback HTTP para Node — handoff IA→IA (F34)
│   ├── escalate_to_supervisor.py
│   ├── trigger_flow.py
│   ├── mark_resolved.py
│   └── change_conversation_status.py
└── http/
    └── custom_webhook.py        # se workspace tem custom tools (fase 2)
```

### 6.2 Tool "leve" (executa em Python)

```python
# apps/agent-runtime/app/tools/database/query_contact.py
from pydantic import BaseModel, Field
from app.tools.types import ToolDescriptor, ToolContext

class Args(BaseModel):
    fields: list[str] = Field(default_factory=lambda: ["name", "phone", "email", "tags"])

async def handler(args: Args, ctx: ToolContext):
    if ctx.is_playground:
        return { "success": True, "simulated": True, "payload": { "name": "Maria Exemplo", ... } }
    async with ctx.pg.acquire() as conn:
        await conn.execute("SET LOCAL app.workspace_id = $1", ctx.workspace_id)
        # column-level ACL aplicado: filtra args.fields contra ctx.tool.config.allowed_columns.read
        safe_fields = [f for f in args.fields if f in ctx.tool.config["allowed_columns"]["read"]]
        row = await conn.fetchrow(f"SELECT {','.join(safe_fields)} FROM contacts WHERE id = $1", ctx.contact_id)
    return { "success": True, "payload": dict(row) if row else None }

query_contact_tool = ToolDescriptor(
    key="query_contact",
    name="Consultar contato",
    description="Lê dados do contato atual.",
    category="database",
    args_schema=Args,
    handler=handler,
)
```

### 6.3 Tool "de negócio" (callback HTTP para Node)

```python
# apps/agent-runtime/app/tools/workflow/transfer_to_human.py
from pydantic import BaseModel

class Args(BaseModel):
    reason: str
    department_id: str | None = None

async def handler(args: Args, ctx: ToolContext):
    if ctx.is_playground:
        return { "success": True, "simulated": True, "payload": { "transferred_to": "humano (sim)" } }
    # callback HTTP para Node — single source of truth de regras de negócio
    r = await ctx.http.post(
        f"{settings.NODE_API_INTERNAL_URL}/internal/tools/transfer_to_human",
        headers={"Authorization": f"Bearer {settings.AGENT_RUNTIME_TOKEN}"},
        json={
            "workspace_id": ctx.workspace_id,
            "conversation_id": ctx.conversation_id,
            "agent_id": ctx.agent_id,
            "args": args.model_dump(),
        },
    )
    r.raise_for_status()
    return r.json()
```

### 6.4 OpenAI schema do Pydantic

```python
def tool_to_openai_schema(tool: ToolDescriptor) -> dict:
    return {
        "type": "function",
        "function": {
            "name": tool.key,
            "description": tool.description,
            "parameters": tool.args_schema.model_json_schema(),
        },
    }
```

### 6.5 Column-level access control

`tool.config` carrega `allowed_columns`, `restricted_columns`, `required_columns` (mantém v1). Handler aplica antes do SQL.

### 6.6 Parallel execution

Se `state["policy"].allow_parallel_tools=true`, `tool_dispatch` usa `asyncio.gather`. Caso contrário, sequencial. Permite super-admin reduzir custo em workspaces premium-low.

---

## 7. Tools do MVP

Mesmas categorias e ferramentas seed do v1 (replicadas em Python):

### 7.1 Database

| key | descrição | escreve | lê |
|---|---|---|---|
| `query_contact` | Lê dados do contato atual | — | name, email, phone, tags, source, custom_fields (whitelist) |
| `update_contact` | Atualiza dados do contato | name, email, phone, custom_fields (whitelist) | — |
| `add_contact_tag` | Marca contato com tag | tag → contact_tags | — |
| `remove_contact_tag` | Remove tag | tag ← contact_tags | — |
| `query_conversation` | Lê status da conversa atual | — | status, ai_mode, assigned_to, department |
| `move_deal_stage` | Move deal do contato pra próximo stage | deals.stage_id | — |
| `query_recent_messages` | Lê últimas N mensagens | — | messages |

### 7.2 Calendar

| key | descrição | execução |
|---|---|---|
| `list_calendars` | Lista calendários do workspace | Python direto |
| `get_available_slots` | Retorna slots (chama `compute_available_slots`) | Python direto |
| `schedule_event` | Cria evento | callback Node |

### 7.3 Knowledge

| key | descrição |
|---|---|
| `search_knowledge_base` | RAG: pgvector cosine + ranking; retorna top K |

### 7.4 Workflow (todas callback Node)

| key | descrição | aprovação humana? |
|---|---|---|
| `transfer_to_human` | Marca `conversation.ai_mode='off'` + assigna | não |
| `transfer_to_agent` | Handoff IA→IA: passa a conversa para outro agente de IA do mesmo dept (vide §7.6) | não (authz de alvo é a salvaguarda) |
| `escalate_to_supervisor` | Cria notificação para SUPERVISOR | não |
| `trigger_flow` | Dispara `flows` por `key` | sim, se configurado |
| `mark_resolved` | Fecha conversa (status='resolved') | sim, sempre |
| `change_conversation_status` | Muda status | não |
| `register_conversion` | Registra `conversion_events` (vide DASHBOARD.md §13) — args: `{type_key, value_cents?, note?}` | depende: ligada por default se `conversion_type.value_required=true` (envolve dinheiro); desligada se evento puro (agendamento). Configurável por workspace em `workspace_agent_policies.allow_agent_conversions` |

### 7.5 Instagram-specific (após F1.5)

| key | descrição | aprovação humana? |
|---|---|---|
| `reply_to_comment` | Resposta pública a um comment IG | não |
| `private_reply_to_comment` | Comment-to-DM | não |
| `hide_comment` | Esconde comment | sim, por default |
| `delete_comment` | Deleta comment | sim, sempre |

### 7.6 Roteamento agente ↔ departamento + handoff IA→IA (F34)

Um agente de IA não é mais "o agente único do workspace": ele é **vinculado a um ou mais
departamentos** (N:N) e a conversa resolve para o agente certo conforme o departamento dela.
Quando um departamento tem vários agentes, eles podem **alternar entre si** de forma
**autônoma** (via prompt, esta seção) e **manual** (cockpit, vide `LIVECHAT_OPS.md §2.1`).

**Vínculo agente ↔ departamento (N:N).** Tabela `agent_departments(agent_id, department_id,
workspace_id, is_default, created_at)` com RLS por `workspace_id` e `is_default` marcando o
**agente de ENTRADA** daquele departamento (no máximo 1 default por dept, via índice parcial
único). O owner gerencia isso no editor de agente (4º passo "Departamentos"). Repo: `agentDepartmentsRepo`
(`listDepartmentsForAgent`, `listAgentsForDepartment`, `getDefaultAgentForDepartment`,
`setAgentDepartments`, `areAgentsInSameDepartment`).

**Resolução por departamento** (`loadContext`, worker de agentes). Ordem:
1. `conversation.agent_id` já setado → usa ele (**sticky**: transferências e troca manual persistem aqui).
2. Senão, resolve pelo `conversation.department_id` → **agente default daquele dept** (`is_default`).
3. Fallback: sem dept ou sem default → agente default do workspace (comportamento legado).
4. **Persiste** o agente resolvido em `conversation.agent_id` (sticky) — turnos seguintes e o cockpit
   passam a ver o mesmo agente.

**Tool `transfer_to_agent`** (autônoma, IA→IA). Workflow tool com callback Node — *single source
of truth* do efeito de negócio no Node (`apps/api/src/internal/tools/agent-transfer-handlers.ts`);
o lado Python (`apps/agent-runtime/app/tools/workflow/transfer_to_agent.py`) só declara metadados + `Args`.

- **Contrato de args** (Zod `transferToAgentArgs` é a fonte da verdade; o Pydantic casa 1:1 em
  camelCase de wire): `{ targetAgentId: string (uuid), reason?: string (1..500) }`.
- **Authz de alvo (salvaguarda do sistema):** a tool roda server-to-server (token de runtime, não
  por membro humano), então a salvaguarda não é uma permissão de role — é
  `agentDepartmentsRepo.areAgentsInSameDepartment(agentAtual, targetAgent)`. O agente atual só
  transfere para agentes que **compartilham ≥1 departamento** com ele. Destino fora disso é
  rejeitado **sem efeito**. (Escalonamento cross-dept fica como TODO honesto até existir flag de
  departamento-destino — vide D3.)
- **Efeito (se elegível):** fixa `conversation.agent_id = targetAgentId` (sticky), reativa
  `ai_mode='on'` e limpa pausa pendente (`ai_paused_*` → null), re-engaja enfileirando
  `flow.run.requested` em `hm.q.flows`. **Idempotente:** transferir para o agente já atual é no-op
  gracioso (sem mutação, sem enqueue). O `content` devolvido instrui a IA a parar de responder.
- **NÃO confundir** com `conversation.assign_agent`: aquela é a troca **manual** pelo operador no
  cockpit (matriz de roles, `LIVECHAT_OPS.md §2.1`); esta é a transferência **autônoma** decidida
  pela LLM.

**Diretriz de prompt + lista de pares** (`build_prompt`). Quando `agent.allow_handoff=true` **e** o
agente tem pares no(s) dept(s), o `build_prompt` injeta um bloco que instrui a usar
`transfer_to_agent` com o `targetAgentId` do par certo, seguido da lista de pares disponíveis
(nome, id, departamento e quando transferir). O `load_context` aplica o gate antes — sem
`allow_handoff` ou sem pares, nada é injetado (zero regressão no fluxo sem handoff).

**Contexto IA→IA.** O histórico rotula a autoria de cada turno. Além de `human | ai | contact`, há o
rótulo **`ai_other` → "Outro agente de IA"** (F34): quando outro agente de IA atendeu parte da
conversa antes do handoff, o agente que assume vê o histórico atribuído corretamente e retoma com
consciência — exatamente como já fazia no handoff IA→humano.

---

## 8. Aplicação de policy (super-admin → runtime)

### 8.1 Resolução no Node (pre-call)

```ts
// apps/api/src/services/agent/runAgent.ts (Node)
import { agentsClient } from '@hm/agents-client';

export async function runAgent(input: RunAgentInput) {
  const policy = await loadWorkspacePolicy(input.workspaceId);   // SELECT workspace_agent_policies + plan defaults
  const agent  = await loadAgent(input.agentId);

  // 1. valida model contra whitelist
  if (!policy.allowedModels.includes(agent.model)) {
    throw new ForbiddenError(`Model ${agent.model} not allowed for this workspace`);
  }

  // 2. hard cap pre-call
  const monthlySpend = await sumLlmUsageMonth(input.workspaceId);
  if (policy.maxMonthlyCostUsd != null && monthlySpend >= policy.maxMonthlyCostUsd) {
    throw new BudgetExceededError(`Monthly cap ${policy.maxMonthlyCostUsd} USD reached`);
  }

  // 3. filtra tools contra allowedToolCategories
  const availableTools = (await loadAgentTools(input.agentId))
    .filter(t => policy.allowedToolCategories.includes(t.category))
    .slice(0, policy.maxToolsPerAgent);

  // 4. chama agent-runtime via cliente tipado
  const stream = agentsClient.run({
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    userInput: input.userInput,
    policy_snapshot: {
      allowedModels: policy.allowedModels,
      allowStreaming: policy.allowStreaming,
      allowInterrupts: policy.allowInterrupts,
      allowParallelTools: policy.allowParallelTools,
      allowVision: policy.allowVision,
      allowTranscription: policy.allowTranscription,
      maxIterations: policy.maxIterations,
      maxTokensPerCall: policy.maxTokensPerCall,
      maxToolsPerAgent: policy.maxToolsPerAgent,
      allowedToolCategories: policy.allowedToolCategories,
      remainingMonthlyBudgetUsd: policy.maxMonthlyCostUsd != null ? policy.maxMonthlyCostUsd - monthlySpend : null,
    },
    tools: availableTools,
  });

  yield* stream;
}
```

### 8.2 Defense-in-depth no runtime Python

Mesmo com policy chegando do Node, o runtime aplica:

```python
def apply_policy(state: AgentState) -> AgentState:
    p = state["policy"]
    # bloqueia modelo fora da whitelist (paranoia: já validado no Node)
    if state["agent"]["model"] not in p.allowed_models:
        raise PermissionError(f"Model not allowed by policy")
    # corta tools fora das categorias permitidas
    state["tools"] = [t for t in state["tools"] if t["category"] in p.allowed_tool_categories][:p.max_tools_per_agent]
    # bloqueia vision/transcription se desligado
    if not p.allow_vision and state["agent"].get("model_supports_vision"):
        state["agent"]["disable_vision"] = True
    return state
```

### 8.3 Audit de policy changes

Toda alteração em `workspace_agent_policies` registra em `audit_logs` com `action='workspace_agent_policy.update'`, `actor_type='platform_admin'`. Histórico fica auditável.

---

## 9. Context construction (`build_prompt_node`)

```python
async def build_prompt_node(state: AgentState) -> dict:
    sys_parts = [state["agent"]["system_prompt"]]

    if state["contact"]:
        c = state["contact"]
        sys_parts.append(f"Você está conversando com {c.get('display_name') or 'um cliente'}.")
        if c.get("custom_fields"):
            sys_parts.append(f"Dados do contato: {json.dumps(c['custom_fields'])}")

    if state["conversation"]:
        conv = state["conversation"]
        sys_parts.append(f"Canal: {conv['channel_provider']}. Status: {conv['status']}.")
        # IG-specific
        if conv.get("kind") == "comment_thread":
            sys_parts.append(
                "Você está respondendo um comentário em um post/reel do Instagram. "
                "Avalie se a resposta deve ser pública (visível a todos) ou privada (comment-to-DM). "
                "Não esconda comentários a menos que sejam claramente spam ou ofensivos."
            )

    if state["tools"]:
        sys_parts.append("POLÍTICA DE USO DE FERRAMENTAS:")
        sys_parts.append("- Use ferramentas quando a intenção indica ação concreta.")
        sys_parts.append("- Não anuncie que vai usar ferramenta; use direto.")
        sys_parts.append("- Se a ação requer dados ausentes, pergunte ao usuário.")

    if any(t["key"] == "search_knowledge_base" for t in state["tools"]):
        sys_parts.append("Antes de inventar uma resposta sobre o produto, sempre busque na base de conhecimento.")

    recent = [m for m in state["messages"] if m.role != 'system'][-12:]

    return {
        "messages": [
            ChatMessage(role='system', content="\n\n".join(sys_parts)),
            *recent,
            ChatMessage(role='user', content=state["user_input"]),
        ],
    }
```

---

## 10. Streaming para o frontend

### 10.1 SSE: Node proxy

```ts
// apps/api/src/routes/agents.ts (Node)
router.post('/api/agents/:agentId/run', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  for await (const chunk of runAgent({
    workspaceId: req.workspace.id,
    agentId: req.params.agentId,
    conversationId: req.body.conversationId,
    userInput: req.body.userInput,
  })) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end();
});
```

### 10.2 Eventos emitidos

```ts
type AgentStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_call_started'; toolKey: string; args: unknown }
  | { type: 'tool_call_completed'; toolKey: string; result: unknown; durationMs: number }
  | { type: 'interrupt'; reason: string; toolKey: string; args: unknown }
  | { type: 'iteration_exceeded' }
  | { type: 'budget_exceeded' }                        // novo no v2
  | { type: 'model_blocked'; reason: string }          // novo no v2
  | { type: 'final'; reply: string; usage: Usage; openrouterGenerationId: string }
  | { type: 'error'; message: string };
```

---

## 11. Cost tracking

```python
# apps/agent-runtime/app/nodes/call_model.py
async def call_model_node(state: AgentState) -> dict:
    start = time.monotonic()
    resp = await openrouter.chat_completion(
        model=state["agent"]["model"],
        messages=[m.model_dump() for m in state["messages"]],
        tools=[tool_to_openai_schema(t) for t in state["tools"]] or None,
        stream=False,
        max_tokens=state["policy"].max_tokens_per_call,
        **state["agent"].get("model_params", {}),
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    usage = resp.get("usage", {})
    generation_id = resp.get("id")
    upstream = resp.get("provider")    # ex: 'openai' | 'anthropic' | ...
    cost = compute_cost_from_usage(state["agent"]["model"], usage)   # fallback enquanto async fetch generation

    await log_llm_usage(
        workspace_id=state["workspace_id"],
        agent_id=state["agent_id"],
        conversation_id=state["conversation_id"],
        execution_id=state["thread_id"],
        request_type='chat',
        router='openrouter',
        openrouter_generation_id=generation_id,
        upstream_provider=upstream,
        model=state["agent"]["model"],
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        reasoning_tokens=usage.get("reasoning_tokens", 0),
        total_tokens=usage.get("total_tokens", 0),
        cost_usd=cost,
        latency_ms=latency_ms,
        finish_reason=resp["choices"][0].get("finish_reason"),
    )

    assistant_msg = parse_assistant_message(resp)
    return {
        "messages": [*state["messages"], assistant_msg],
        "usage": {
            "prompt_tokens": state["usage"]["prompt_tokens"] + usage.get("prompt_tokens", 0),
            "completion_tokens": state["usage"]["completion_tokens"] + usage.get("completion_tokens", 0),
            "total_cost": state["usage"]["total_cost"] + cost,
        },
    }
```

Cost real (fallback fetch via `/generation?id=` da OpenRouter) é trazido por job assíncrono que atualiza `llm_usage_logs.cost_usd` com valor preciso 30-60s depois (OpenRouter expõe o custo real após o billing settling).

---

## 12. RAG: Knowledge Base com pgvector

### 12.1 Ingestão

Continua acontecendo no **Node** (não Python) — é parte do CRUD do workspace, não do runtime de agente.

```ts
// apps/api/src/services/kb/ingest.ts
export async function ingestDocument(input: { workspaceId, title, content, source, category?, tags? }) {
  const doc = await insertKbDocument(input);
  const chunks = semanticChunk(input.content, { chunkSize: 500, overlap: 50 });
  // embeddings via OpenAI direto (OpenRouter não cobre)
  const embeddings = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunks.map(c => c.content),
  });
  await db.insert(kbChunks).values(chunks.map((c, i) => ({
    workspaceId: input.workspaceId,
    documentId: doc.id,
    chunkIndex: i,
    content: c.content,
    contentTokens: c.tokens,
    embedding: embeddings.data[i].embedding,
  })));
  // log em llm_usage_logs com router='openai_direct', request_type='embedding'
  await logLlmUsage({ workspaceId, requestType: 'embedding', router: 'openai_direct', model: 'text-embedding-3-small', ... });
  return doc;
}
```

### 12.2 Retrieval (Python, dentro do `search_knowledge_base` tool)

```python
# apps/agent-runtime/app/tools/knowledge/search_kb.py
async def handler(args: Args, ctx: ToolContext):
    # embedding direto na OpenAI (não OpenRouter)
    emb = await openai_direct.embeddings.create(model="text-embedding-3-small", input=args.query)
    vec = emb.data[0].embedding

    async with ctx.pg.acquire() as conn:
        await conn.execute("SET LOCAL app.workspace_id = $1", ctx.workspace_id)
        rows = await conn.fetch("""
          SELECT c.id, c.content, d.title, d.category,
                 1 - (c.embedding <=> $1::vector) AS similarity
          FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
          WHERE c.workspace_id = $2 AND d.status = 'active' AND d.visible_to_agents = true
          ORDER BY similarity DESC
          LIMIT $3
        """, vec, ctx.workspace_id, args.k or 5)
    return { "success": True, "payload": [dict(r) for r in rows] }
```

---

## 13. Provider abstraction (OpenRouter como default; openai_direct para embeddings/vision/transcription)

```python
# apps/agent-runtime/app/providers/__init__.py
from .openrouter import OpenRouterClient
from .openai_direct import OpenAIDirectClient  # só embeddings, transcription, vision-files

class ProviderRegistry:
    def __init__(self):
        self.openrouter = OpenRouterClient()       # chat
        self.openai = OpenAIDirectClient()         # embeddings/whisper/files

providers = ProviderRegistry()
```

Custom routing/preference é setado em `agents.model_params.openrouter_provider_preference` (fase 2).

---

## 14. Auto follow-up

Substitui `autoAgentFollowup.ts` do v1 com versão idempotente. Continua **no Node** (cron + queue) chamando o agent-runtime para a geração final:

```ts
// apps/workers/src/agents-followup/index.ts (Node)
// Cron: a cada 5 min
async function checkIdleConversations() {
  const candidates = await db.execute(sql`
    SELECT c.id, c.workspace_id, c.agent_id, c.contact_id, a.reply_if_idle_sec
    FROM conversations c
    JOIN agents a ON a.id = c.agent_id
    LEFT JOIN agent_executions ae ON ae.conversation_id = c.id
      AND ae.started_at > NOW() - INTERVAL '2 hours'
      AND ae.metadata->>'kind' = 'follow_up'
    WHERE c.ai_mode = 'on'
      AND c.last_message_from = 'contact'
      AND a.reply_if_idle_sec IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW() - c.last_message_at)) > a.reply_if_idle_sec
      AND ae.id IS NULL
    LIMIT 50
  `);

  for (const c of candidates) {
    for await (const _ of runAgent({
      workspaceId: c.workspace_id,
      agentId: c.agent_id,
      conversationId: c.id,
      contactId: c.contact_id,
      userInput: '__SYSTEM__: Cliente está inativo. Envie follow-up amigável e curto.',
      metadata: { kind: 'follow_up' },
    })) { /* drena stream */ }
    await sleep(1000);  // antiestresse OpenRouter
  }
}
```

---

## 15. Playground

Endpoint `POST /api/agents/:id/playground/run` (Node) chama `agent-runtime` com `is_playground=true`:

- Tools categoria `database` simulam (não escrevem)
- Tools categoria `workflow` simulam (não disparam flows)
- Tools categoria `calendar` simulam (não criam events)
- Stream eventos via SSE igual à execução real
- Resposta inclui `usage` real (chamadas OpenRouter contam para `llm_usage_logs` com metadata `playground=true`)

Permite super-admin definir caps separados de playground (futuro).

---

## 16. Templates seed (5 do v1, mantidos)

Em `0025_seed_global_templates.sql`:

| key | name | category | model default | tools default |
|---|---|---|---|---|
| `sales` | Vendedor | Comercial | `openai/gpt-4o-mini` | query_contact, update_contact, add_contact_tag, move_deal_stage, search_knowledge_base, schedule_event |
| `reception` | Recepcionista | Atendimento | `openai/gpt-4o-mini` | query_contact, update_contact, change_conversation_status, transfer_to_human |
| `support` | Suporte | Atendimento | `openai/gpt-4o-mini` | query_contact, search_knowledge_base, escalate_to_supervisor, mark_resolved |
| `first_touch` | First Touch (outreach inicial) | Marketing | `openai/gpt-4o-mini` | query_contact, update_contact, add_contact_tag |
| `follow_up` | Follow Up | Comercial | `openai/gpt-4o-mini` | query_contact, update_contact, schedule_event, mark_resolved |

Workspace pode trocar `model` para qualquer slug em `policy.allowed_models`.

---

## 17. Decisão sobre flow handler `ai_action`

No v1, `ai_action` apenas **muda flags** do chat (`ai_agent_id`, `status`). NÃO invoca agente. No v2, mesma semântica.

Para invocar agente DENTRO de um flow (caso de uso novo: "agente responde uma pergunta e segue flow"), adicionar handler `invoke_agent` no flow-engine **Node** que chama `agentsClient.run(...)` sincronamente e armazena reply em `variables.last_agent_reply`.

---

## 18. Migração conceitual do v1

| v1 conceito | v2 equivalente |
|---|---|
| `ChatTurn[]` em Redis (`agent:context:{chatId}`) | `state.messages` no LangGraph state + AsyncPostgresSaver (Python) |
| `runAgentReply()` loop manual | `graph.astream()` (Python) chamado via HTTP do Node |
| `finish_reason === 'tool_calls'` check + 5 iterations | conditional edge `should_continue_loop` com `policy.max_iterations` |
| `tool_handlers.service.ts` switch enorme | tool modules em `apps/agent-runtime/app/tools/` (Python) + callback HTTP para Node nas tools de negócio |
| `buildPrompt()` 60 linhas | `build_prompt_node` puro (Python) |
| `agent_tool_logs` table | `tool_logs` table (mesma ideia, naming v2; INSERT do Python via asyncpg) |
| `openai_usage_logs` table | `llm_usage_logs` (com `router`, `openrouter_generation_id`, `upstream_provider`) |
| `agents-runtime.service.ts` (702 linhas) | `apps/agent-runtime/app/graph.py` (~80 linhas) + nodes (~40 linhas cada) + tools modulares |
| Aggregation window (buffer 20s) | Mantém: lógica fica no worker-inbound Node, antes de chamar `agentsClient.run` |
| Auto follow-up cron | `apps/workers/src/agents-followup/` (Node) |
| Playground via `isPlayground: true` flag | Mesmo flag em `ToolContext` (Python) |

---

## 19. Pacote `apps/agent-runtime/`

Estrutura:

```
apps/agent-runtime/
├── pyproject.toml                # uv ou poetry; dependências fixas
├── Dockerfile                    # python:3.13-slim + uvicorn
├── app/
│   ├── main.py                   # FastAPI + LangServe + routes
│   ├── config.py                 # pydantic-settings (env)
│   ├── types.py                  # AgentState, PolicySnapshot, ChatMessage
│   ├── graph.py                  # build_graph(), compile com checkpointer
│   ├── policy.py                 # apply_policy()
│   ├── checkpoint.py             # AsyncPostgresSaver
│   ├── providers/
│   │   ├── openrouter.py
│   │   └── openai_direct.py
│   ├── nodes/
│   │   ├── load_context.py
│   │   ├── build_prompt.py
│   │   ├── call_model.py
│   │   ├── tool_dispatch.py
│   │   └── finalize.py
│   ├── tools/
│   │   ├── registry.py
│   │   ├── types.py
│   │   ├── database/
│   │   ├── calendar/
│   │   ├── knowledge/
│   │   ├── workflow/
│   │   └── http/
│   └── pricing.py                # snapshot de pricing (fallback enquanto generation API responde)
└── tests/
    ├── conftest.py               # pytest fixtures (postgres testcontainer)
    ├── test_graph.py
    └── test_tools/
```

Dependências chave (`pyproject.toml`):

- `langgraph >= 0.6`
- `langgraph-checkpoint-postgres`
- `fastapi`
- `langserve`
- `httpx`
- `asyncpg`
- `pydantic >= 2`
- `pydantic-settings`
- `loguru` (PII redact custom formatter)

CI: job dedicado `python-ci` no GitHub Actions com cache uv + pytest + ruff + mypy.

---

## 20. Não-objetivos do MVP

- ❌ Streaming token-by-token para WhatsApp/Instagram (só pra UI playground; canais recebem mensagem completa)
- ❌ Reranking sofisticado (similarity simples no MVP)
- ❌ Custom tools criadas via UI (apenas tools seed; custom tools entram fase 2 via JSON declarativo)
- ❌ Conversação multi-agente (um agente por conversa por vez)
- ❌ Memória de longo prazo / sumarização automática (compress depois)
- ❌ Provider preference fine-grained no OpenRouter (default routing no MVP)
- ❌ LangSmith integration (preparado via OpenTelemetry, mas integração explícita fica fase 2)

---

## 21. Testes

- **Unit:** cada tool tem teste pytest com mock do Postgres (asyncpg fakes via aiopg-mock ou monkeypatch).
- **Integration:** `graph.astream` end-to-end com Postgres real (testcontainers-python) + OpenRouter mockado (httpx-mock).
- **Playground manual:** UI de playground usada para teste exploratório.
- **Contract tests:** OpenAPI export do Python validado contra `packages/agents-client/` schemas Zod (gera tipos do OpenAPI no build do Node).

---

## 22. Próximos passos após `/hm-init`

1. Setup `apps/agent-runtime/` com FastAPI + LangServe + graph básico (load_context → call_model → finalize).
2. AsyncPostgresSaver setup (rodar `setup()` automaticamente no boot).
3. Implementar 6 tools mais críticas (query_contact, update_contact, search_knowledge_base, schedule_event, transfer_to_human, mark_resolved).
4. Endpoint SSE de execução + playground proxy no Node.
5. Painel super-admin AgentPoliciesPage + LlmModelsCatalogPage.
6. Iterar com Rogério em prompts dos 5 templates seed.

---

> Mudanças neste design exigem nova versão do doc. Schema do `AgentState` e do `PolicySnapshot` são load-bearing — quebrar = quebrar execuções salvas no checkpoint + quebrar invocações em produção.
