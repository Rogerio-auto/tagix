# Feature — FLOW BUILDER

> **Domínio:** Engine de execução de fluxos visuais (não-AI; workflow determinístico)
> **Pacotes:** `packages/flow-engine`, `apps/workers/flows`, `apps/api/src/routes/flows`, `apps/web/src/features/flow-builder`

---

## 1. Conceito

Flow Builder é um sistema de automação visual onde o usuário desenha um grafo de nodes que reagem a triggers (mensagem nova, mudança de stage, etc) e executam ações (enviar mensagem, mover stage, chamar webhook).

**É independente do sistema de Agentes IA.** Agente é IA com tool calling controlado pela LLM. Flow é workflow determinístico controlado pelo usuário.

Os dois conversam:
- Flow → Agente: handler `ai_action` muda `conversation.ai_mode='on'` + `agent_id`.
- Agente → Flow: tool `trigger_flow` dispara um flow por `key`.

---

## 2. Modelo de dados (resumo, completo em DATA_MODEL.md §9)

- `flows` — definição visual (nodes + edges + trigger_config + status)
- `flow_versions` — snapshot ao publicar (execuções referenciam version, não flow direto)
- `flow_executions` — instâncias rodando (status RUNNING/WAITING/COMPLETED/FAILED/CANCELLED)
- `flow_logs` — audit por step
- `flow_submissions` — respostas de Meta Flows externas

---

## 3. Engine (`packages/flow-engine/`)

### 3.1 API pública

```ts
// packages/flow-engine/src/index.ts
export async function triggerFlow(input: {
  workspaceId: string;
  flowId: string;
  conversationId?: string;
  contactId?: string;
  triggerData?: Record<string, unknown>;
  triggeredBy: 'manual' | 'automatic' | 'api';
  triggeredByMemberId?: string;
}): Promise<{ executionId: string }>;

export async function processFlowStep(executionId: string): Promise<void>;

export async function resumeFlowWithResponse(input: {
  conversationId: string;
  responseType: string;
  responseContent: string;
}): Promise<void>;

export async function cancelFlowExecution(executionId: string, reason?: string): Promise<void>;

export async function cancelAllForConversation(conversationId: string): Promise<number>;
```

### 3.2 Algoritmo do `processFlowStep`

1. **Load** `flow_execution` + `flow_version` (não `flow` direto).
2. **Guard:** se status != RUNNING, return (no-op).
3. **Find current node** no `flow_version.nodes` array.
4. **Dispatch:** `handler = registry.get(node.type)`; `result = await handler.execute(node, ctx)`.
5. **Persist log** em `flow_logs`.
6. **Handle result:**
   - `WAITING`: persist `status=waiting`, `next_step_at`, `variables`.
   - `SUCCESS`: encontra próxima edge via `edgeHandle` ou source-only; se nenhuma, `status=completed`.
   - `ERROR`: `status=failed`, `last_error`, retry-strategy decide (ver §6).
7. **Re-enqueue** próximo step em `hm.q.flow.execution`.

### 3.3 Estrutura do registry

```ts
// packages/flow-engine/src/registry.ts
import { triggerHandler } from './handlers/trigger.handler.js';
import { messageHandler } from './handlers/message.handler.js';
// ... etc

export const handlerRegistry = {
  // start
  trigger: triggerHandler,
  // output
  message: messageHandler,
  interactive: interactiveHandler,
  meta_flow: metaFlowHandler,
  template: templateHandler,
  // timing
  wait: waitHandler,
  wait_for_response: waitForResponseHandler,
  input: inputHandler,
  // logic
  condition: conditionHandler,
  switch: switchHandler,
  ab_split: abSplitHandler,
  go_to_flow: goToFlowHandler,
  // system
  ai_action: aiActionHandler,
  add_tag: addTagHandler,
  remove_tag: removeTagHandler,
  move_stage: moveStageHandler,
  change_status: changeStatusHandler,
  assign: assignHandler,
  set_variable: setVariableHandler,
  register_conversion: registerConversionHandler,
  // external
  http_request: httpRequestHandler,
  external_notify: externalNotifyHandler,
} as const;

export type FlowNodeType = keyof typeof handlerRegistry; // 22 tipos

export type FlowNodeType = keyof typeof handlerRegistry;
```

### 3.4 Handler interface

```ts
export type FlowHandlerResult =
  | { status: 'SUCCESS'; edgeHandle?: string; variables?: Record<string, unknown> }
  | { status: 'WAITING'; nextStepAt: string; variables?: Record<string, unknown> }
  | { status: 'ERROR'; error: string };

export interface FlowHandler<TNodeData> {
  schema: z.ZodSchema<TNodeData>;
  execute(node: FlowNode<TNodeData>, ctx: FlowExecutionContext): Promise<FlowHandlerResult>;
}
```

Cada handler em `packages/flow-engine/src/handlers/<name>.handler.ts`:

```ts
import { z } from 'zod';

const messageSchema = z.object({
  text: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaType: z.string().optional(),
  preAction: z.enum(['typing','recording']).optional(),
  preActionDurationMs: z.number().min(0).max(600_000).optional(),
  audioMessageKind: z.enum(['voice','audio_file']).optional(),
});

export const messageHandler: FlowHandler<z.infer<typeof messageSchema>> = {
  schema: messageSchema,
  async execute(node, ctx) {
    const data = messageSchema.parse(node.data);

    if (data.preAction) {
      await runPreAction({ presence: data.preAction, durationMs: data.preActionDurationMs ?? 1500, conversationId: ctx.conversationId });
    }

    await sendFlowMessage({
      conversationId: ctx.conversationId,
      text: data.text ? interpolate(data.text, ctx.variables) : undefined,
      mediaStorageKey: data.mediaUrl,
      mediaType: data.mediaType,
      audioMessageKind: data.audioMessageKind,
    });

    return { status: 'SUCCESS' };
  },
};
```

---

## 4. Os 22 node types (v2 — F31)

### 4.1 Tabela completa (22 node types v2)

| Tipo | Categoria | Funcao | Edge handles | Side effects |
|---|---|---|---|---|
| `trigger` | start | no inicial; identifica trigger | default | nenhum |
| `message` | output | envia mensagem (texto/midia/audio/voz) | default | publish outbound |
| `interactive` | output | envia interactive buttons/list | default | publish outbound |
| `meta_flow` | output | dispara WhatsApp Flow (Meta) | default | publish outbound |
| `template` | output | envia HSM/template aprovado; reabre janela 24h WA | default | publish outbound (seam: publisher precisa suporte HSM) |
| `wait` | timing | espera N minutos | default | persist `next_step_at` |
| `wait_for_response` | timing | envia opcional + aguarda resposta | response, timeout | persist waiting state |
| `input` | timing | envia prompt + valida resposta tipada (text/email/phone/number/date) + retry | response, timeout | persist waiting state; grava `input.<var>` |
| `condition` | logic | binary: HAS_TAG, IN_STAGE, BUSINESS_HOURS, HAS_VALUE, MSG_CONTAINS, MSG_EQUALS | true, false | nenhum |
| `switch` | logic | multi-branch baseado em variavel | edges por case | nenhum |
| `ab_split` | logic | distribui por peso proporcional (roulette wheel) | edges por key de variante | nenhum |
| `go_to_flow` | logic | encadeia para outro flow ativo (guard MAX_DEPTH=5 anti-loop) | nenhuma (encerra exec atual) | cria nova `flow_execution`; worker enfileira via `_goto_flow_execution_id` |
| `ai_action` | system | controla agente IA (ACTIVATE/DEACTIVATE/TRANSFER) | default | update `conversations.ai_mode`, `agent_id` |
| `add_tag` | system | adiciona tag ao contato | default | insert `contact_tags` |
| `remove_tag` | system | remove tag | default | delete `contact_tags` |
| `move_stage` | system | move deal para stage | default | update `deals.stage_id` + insert `deal_history` |
| `change_status` | system | muda status da conversa | default | update `conversations.status` |
| `assign` | system | atribui conversa (specific/round_robin/least_busy) | default | update `conversations.assigned_to` + insert `routing_history` |
| `set_variable` | system | grava variavel no namespace `vars.*` com interpolacao e coercao de tipo | default | merge em `flow_executions.variables` |
| `register_conversion` | system | registra conversao (idempotente same-day via unique constraint) | default | insert `conversion_events` |
| `http_request` | external | HTTP GET/POST/PUT/PATCH/DELETE | success, error | nenhum (armazena response em `webhook_response`) |
| `external_notify` | external | envia msg a terceiro (responsavel, contato externo, custom phone) | default (ou response/timeout se wait) | publish outbound em outra conversa |

### 4.2 Wait_for_response biestável

Dois estados:

**Primeira chamada:**
- Se `text` ou `mediaUrl` configurado, envia mensagem (interpolated).
- Set `variables.waiting_for_response = true`, `variables.waiting_started_at = now`.
- Return `{ status: 'WAITING', nextStepAt: now + timeoutMinutes }`.

**Resumption:**
- Triggered por `resumeFlowWithResponse(conversationId, responseType, content)`.
- Se `variables.waiting_for_response`: set `variables.responded = true`, `variables.last_response = content`, `variables.response_edge = responseType`.
- Re-enqueue execution.
- Engine reprocessa: handler vê `responded=true` → return `{ status: 'SUCCESS', edgeHandle: 'response' }`.
- Limpa markers `waiting_for_response`, `responded`.

**Timeout:**
- Scheduler cron busca executions com `status=waiting` AND `next_step_at <= now`.
- Re-enqueue.
- Handler vê `waiting_for_response=true` AND não `responded` → return `{ edgeHandle: 'timeout' }`.

### 4.3 External_notify biestável

Igual `wait_for_response`, mas envia pra outra conversa (com base em `target`: RESPONSIBLE, ENTITY_CUSTOMER, FLOW_CONTACT, CUSTOM). Resolução de phone:
- `RESPONSIBLE`: `variables.responsible_phone`
- `ENTITY_CUSTOMER`: `variables.customer_phone` (do flow's deal/contact)
- `FLOW_CONTACT`: phone do contato do flow
- `CUSTOM`: `config.custom_phone`

Cria/encontra `contact` para esse phone + cria/encontra `conversation` no `channelId` selecionado (não-Meta por default).

---

## 5. Triggers

| Trigger | Quando dispara | Config |
|---|---|---|
| `manual` | API call `POST /flows/:id/trigger` ou quickbar UI | conversationId obrigatório |
| `stage_change` | deal entrou ou saiu de stage | `from_stage_id`, `to_stage_id` |
| `tag_added` | tag adicionada em contact | `tag_id` |
| `keyword` | mensagem inbound contém keyword | `keyword` (case-insensitive) |
| `new_lead` | novo contact criado | `source` filter |
| `new_message` | nova mensagem inbound | `message_types` filter (text, interactive, etc) |
| `system_event` | evento interno (deal created, agent handoff) | `event` enum |
| `flow_submission` | Meta Flow respondido | `meta_flow_id` |

### 5.1 Avaliação de triggers (event dispatch)

Worker-inbound, ao persistir nova mensagem:

```ts
async function dispatchTriggersForNewMessage(message: Message, conversation: Conversation) {
  const activeFlows = await db.flows.findMany({
    where: and(
      eq(flows.workspaceId, message.workspaceId),
      eq(flows.status, 'active'),
      inArray(flows.triggerType, ['keyword', 'new_message']),
    ),
  });

  for (const flow of activeFlows) {
    if (await evaluateTrigger(flow, { message, conversation })) {
      await triggerFlow({
        workspaceId: flow.workspaceId,
        flowId: flow.id,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        triggerData: { message: message.content, messageType: message.type },
        triggeredBy: 'automatic',
      });
    }
  }
}
```

Worker-outbound (após mensagem enviada) não dispara triggers — só inbound.

Outros triggers (stage_change, tag_added) são disparados pelos handlers das tabelas afetadas:

```ts
// em deal-service.ts
async function moveDealStage(dealId: string, newStageId: string, actor: Actor) {
  // ... update + history
  await dispatchTriggersForStageChange({ dealId, fromStageId, toStageId: newStageId });
}
```

---

## 6. Retry & error handling

### 6.1 Retry per handler

Handlers tipo `http_request`, `external_notify` têm retry policy:

```ts
{
  maxAttempts: 3,
  backoff: 'exponential',
  initialDelayMs: 1000,
  maxDelayMs: 30000,
}
```

Configurável por node em `node.data.retryPolicy`.

### 6.2 Execution-level failure

Se handler retorna `ERROR`:
- `flow_executions.last_error` set
- `flow_executions.status = 'failed'`
- Se `node.data.fallbackEdgeHandle` set, segue pra essa edge em vez de falhar (retry policy interna)

### 6.3 DLQ

Mensagens em `hm.q.flow.execution` que falham 3× vão pra DLQ. Admin panel mostra. Operador pode re-enqueue manual.

---

## 7. Versionamento (NOVO no v2)

Quando user clica "Publicar":

1. Snapshot dos nodes+edges+trigger_config em `flow_versions` com `version = (max+1)`.
2. `flow.status = 'active'`.

Execuções referenciam `flow_version_id`. Mudanças no flow após publicar **NÃO afetam** execuções em andamento.

Re-publicar = nova version. Versão anterior fica acessível em `flow_versions` para auditoria.

UI mostra "Version 5 (current)" + dropdown para ver versions anteriores em read-only.

---

## 8. Interpolação

```ts
// packages/flow-engine/src/utils/interpolate.ts
export function interpolate(text: string, vars: Record<string, unknown>): string {
  return text.replace(/{{\s*([\w.-]+)\s*}}/g, (full, path) => {
    const value = path.split('.').reduce((obj: any, key: string) => obj?.[key], vars);
    return value !== undefined ? String(value) : full;
  });
}
```

Escopo (`variables` JSONB):
- `trigger.*` — dados do evento que disparou
- `contact.*` — dados do contato (name, phone, email, custom_fields.*)
- `conversation.*` — status atual
- `deal.*` — se flow é trigger de stage_change
- `last_response`, `last_response_type` — após wait_for_response
- `webhook_response.*` — após http_request
- `input.<variable>` — resposta validada pelo node `input` (ex.: `{{input.email}}`)
- `vars.<variable>` — variavel definida por `set_variable` (ex.: `{{vars.cidade}}`)
- `webhook_response.*` — apos http_request
- `_flow_depth` — profundidade de encadeamento de go_to_flow (incrementa a cada hop)
- `_goto_flow_execution_id` — ID da execucao criada por go_to_flow (worker enfileira)
- Custom keys adicionadas por outros handlers

---

## 9. Frontend (Flow Builder UI)

### 9.1 Stack

- `@xyflow/react` (ReactFlow)
- `react-flow-renderer` para canvas
- DnD do palette para canvas
- Zustand local store por canvas (changes, undo/redo)

### 9.2 Estrutura

```
apps/web/src/features/flow-builder/
├── pages/
│   ├── FlowsListPage.tsx          # lista + manual flows order DnD
│   └── FlowEditorPage.tsx         # canvas + inspector
├── components/
│   ├── canvas/
│   │   ├── FlowCanvas.tsx
│   │   ├── ToolbarTop.tsx
│   │   ├── NodePalette.tsx        # painel esquerdo
│   │   └── ExecutionsPanel.tsx    # painel direito (executions ativas)
│   ├── nodes/                     # 1 pasta por tipo
│   │   ├── trigger/
│   │   │   ├── TriggerNode.tsx
│   │   │   ├── TriggerInspector.tsx
│   │   │   └── metadata.ts        # label, color, icon
│   │   ├── message/
│   │   ├── interactive/
│   │   ├── condition/
│   │   ├── switch/
│   │   ├── wait/
│   │   ├── wait_for_response/
│   │   ├── ai_action/
│   │   ├── add_tag/
│   │   ├── remove_tag/
│   │   ├── move_stage/
│   │   ├── change_status/
│   │   ├── http_request/
│   │   ├── external_notify/
│   │   └── meta_flow/
│   ├── inspector/
│   │   ├── InspectorPanel.tsx     # container; resolve qual Inspector renderizar
│   │   └── VariablesPicker.tsx    # picker de variáveis pra inputs
│   └── shared/
│       ├── helpers-context.tsx    # context com tags, stages, agents, channels
│       └── validation-banner.tsx  # erros de validação Zod
├── hooks/
│   ├── useFlow.ts                 # CRUD via TanStack Query
│   ├── useFlowEditor.ts           # zustand local + save
│   ├── useManualFlows.ts          # lista quickbar (com manual_position)
│   └── useFlowExecutions.ts       # active executions count
└── services.ts                    # API calls
```

### 9.3 Validações antes de publicar

```ts
const flowValidation = z.object({
  nodes: z.array(z.any()).min(1),
  edges: z.array(z.any()),
}).superRefine((flow, ctx) => {
  const triggerNodes = flow.nodes.filter(n => n.type === 'trigger');
  if (triggerNodes.length !== 1) ctx.addIssue({ message: 'Exatamente 1 trigger node necessário' });

  const reachable = computeReachable(flow.nodes, flow.edges, triggerNodes[0]);
  const unreachable = flow.nodes.filter(n => !reachable.has(n.id));
  if (unreachable.length > 0) {
    ctx.addIssue({ message: `${unreachable.length} nodes inalcançáveis` });
  }

  // detect ciclos
  if (hasCycle(flow.nodes, flow.edges)) {
    ctx.addIssue({ message: 'Ciclo detectado no grafo' });
  }

  // detect undefined variables
  for (const node of flow.nodes) {
    const refs = extractVarReferences(node);
    for (const ref of refs) {
      if (!isKnownVar(ref)) ctx.addIssue({ message: `Variável desconhecida: {{${ref}}}` });
    }
  }
});
```

### 9.4 Manual flows quickbar

Lista de flows com `trigger_type='manual'` ordenada por `manual_position`. Lista renderizada em ChatHeader (acima do composer). Click → modal de confirmação → API call dispara.

### 9.5 Executions panel

Sidebar opcional no editor + badge na ChatList. Lista executions ativas. Click → detalhes (logs, variables, current node).

Botão "Cancelar" → confirmation → `cancelFlowExecution(id)` → socket emit → UI atualiza.

---

## 10. API

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/flows` | Lista flows do workspace |
| POST | `/api/flows` | Cria flow draft |
| GET | `/api/flows/:id` | Detalhe + versions |
| PUT | `/api/flows/:id` | Update draft (não publica) |
| POST | `/api/flows/:id/publish` | Cria nova version + ativa |
| POST | `/api/flows/:id/unpublish` | status=paused (não cancela executions) |
| POST | `/api/flows/:id/archive` | status=archived |
| POST | `/api/flows/:id/trigger` | Dispara manual |
| GET | `/api/flows/:id/versions` | Histórico de versions |
| GET | `/api/flows/:id/executions` | Executions desse flow |
| GET | `/api/flow-executions/:id` | Detalhe de uma execution + logs |
| POST | `/api/flow-executions/:id/cancel` | Cancela execution |
| PATCH | `/api/flows/manual-order` | Atualiza `manual_position` (FX-029a) |

---

## 11. Métricas

- Execução média por step P95 < 500ms (exceto handlers externos).
- Backlog em `hm.q.flow.execution` < 100 normal; alerta > 500.
- Failure rate < 1%.
- Manual triggers / dia (por workspace) — métrica de adoção.

---

## 12. Riscos & mitigations

| Risco | Mitigação |
|---|---|
| Engine quebra a cada deploy mudando schema dos node.data | Zod schema versionado por node type; migration runner ao carregar `flow_versions` antigas |
| Infinite loop em flow circular | Pre-publish validation detecta cycles |
| `http_request` trava worker | Timeout per request 30s + retry policy |
| Memory leak em flows muito longos | Worker reciclado após N executions ou X memory threshold |

---

## 13. Próximos passos pós `/hm-init`

1. Setup `packages/flow-engine/` com types + registry.
2. Implementar 4 handlers básicos: trigger, message, wait, condition.
3. Setup worker-flows.
4. Implementar API CRUD + endpoint trigger.
5. Frontend: canvas básico + 4 nodes.
6. Iterar adicionando handlers restantes.
