/**
 * Ports de infraestrutura da engine (DB/MQ/relogio/outbound). Injetados no `index.ts`
 * com implementacao real (Drizzle sob RLS, RabbitMQ, fetch); mockados nos testes.
 *
 * O dispatcher e os builders de contexto dependem SO desta interface — nunca de `@hm/db`
 * ou `amqplib` direto. Isso mantem o nucleo testavel sem Postgres/Rabbit no loop.
 */
import type {
  FlowEdge,
  RegisteredFlowHandler,
  FlowHttpRequest,
  FlowHttpResponse,
  FlowLogLevel,
  FlowNode,
  FlowOutboundMessage,
  FlowPresenceAction,
} from './types';

/**
 * Estados PUBLICOS de uma execucao (persistidos por transicoes da engine e emitidos em
 * eventos F51). `processing` fica FORA deste conjunto: e um estado interno de claim.
 */
export type FlowExecutionPublicStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Estado completo em `flow_executions.status`. `processing` (F56-S13/INF-04) = step
 * reivindicado por um consumer: escrito SOMENTE pelo claim atomico do FlowDbPort, nunca
 * por `ExecutionPatch`. Nao e emitido em `FlowExecutionEvent` (transiente, sub-segundo).
 */
export type FlowExecutionStatus = FlowExecutionPublicStatus | 'processing';

/** Snapshot de uma execucao carregada (`flow_executions` + `flow_versions`). */
export interface LoadedExecution {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly flowId: string;
  readonly flowVersionId: string;
  readonly conversationId: string | null;
  readonly contactId: string | null;
  readonly status: FlowExecutionStatus;
  readonly currentNodeId: string | null;
  /** Steps ja executados (incrementado pelo claim). Alimenta o teto anti-loop (INF-05). */
  readonly stepCount: number;
  readonly variables: Record<string, unknown>;
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
}

/** Patch parcial aplicado a `flow_executions` ao final de um step. */
export interface ExecutionPatch {
  readonly status?: FlowExecutionPublicStatus;
  readonly currentNodeId?: string | null;
  readonly variables?: Record<string, unknown>;
  readonly nextStepAt?: Date | null;
  readonly lastError?: string | null;
  readonly completedAt?: Date | null;
}

/**
 * Opcoes de fencing de um patch (INF-04): quando `expectStatus` esta presente, o UPDATE
 * so aplica se o status ATUAL da linha estiver no conjunto — transicao read-then-act vira
 * compare-and-set. Um step que perdeu o claim (cancel concorrente, takeover de lease) tem
 * o patch final recusado e NAO deve re-enfileirar.
 */
export interface PatchExecutionOptions {
  readonly expectStatus?: readonly FlowExecutionStatus[];
}

/** Motivo pelo qual um claim NAO reivindicou a linha (decide drop vs retry no dispatcher). */
export type FlowClaimSkipReason =
  /** execucao inexistente (deletada / envelope invalido). */
  | 'not_found'
  /** ja terminou (completed/failed/cancelled) — envelope duplicado tardio, absorvido. */
  | 'terminal'
  /** waiting com `next_step_at` no futuro — wakeup prematuro/duplicado; o scheduler acorda no prazo. */
  | 'not_due'
  /** outro consumer detem o claim (processing dentro do lease) — duplicado concorrente OU crash recente. */
  | 'in_flight';

/** Resultado do claim atomico de um step. */
export type FlowClaimResult =
  | { readonly claimed: true; readonly execution: LoadedExecution }
  | { readonly claimed: false; readonly reason: FlowClaimSkipReason };

export interface FlowLogEntry {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly level: FlowLogLevel;
  readonly message: string;
  readonly payload?: Record<string, unknown>;
}

export interface TriggerFlowDbInput {
  readonly workspaceId: string;
  readonly flowId: string;
  readonly conversationId?: string;
  readonly contactId?: string;
  readonly triggeredBy: 'manual' | 'automatic' | 'api';
  readonly triggeredByMemberId?: string;
  readonly variables: Record<string, unknown>;
}

/** Port de banco — tudo escopado por workspace (RLS) na impl real. */
export interface FlowDbPort {
  /**
   * Cria a execucao a partir do flow ATIVO: resolve a `flow_version` corrente, persiste
   * `flow_executions` (status=running, current_node=trigger) e retorna o id.
   */
  createExecution(input: TriggerFlowDbInput): Promise<{ executionId: string }>;
  loadExecution(workspaceId: string, executionId: string): Promise<LoadedExecution | null>;
  /** Carrega resolvendo o workspace internamente (entrypoint sem escopo, FLOW_BUILDER API). */
  loadExecutionByIdOnly(executionId: string): Promise<LoadedExecution | null>;
  /**
   * Claim ATOMICO de um step (INF-04): um unico UPDATE condicional que transiciona a linha
   * para `processing` (incrementando `step_count`) SE ela estiver reivindicavel:
   * `running` | `waiting` vencida (`next_step_at <= now()`) | `processing` com lease
   * expirado (takeover pos-crash). Exatamente UM de N envelopes concorrentes reivindica.
   */
  claimExecution(workspaceId: string, executionId: string): Promise<FlowClaimResult>;
  /** Claim resolvendo o workspace internamente (entrypoint sem escopo). */
  claimExecutionByIdOnly(executionId: string): Promise<FlowClaimResult>;
  /**
   * Aplica um patch; com `expectStatus` vira compare-and-set (fencing do claim).
   * Retorna se alguma linha foi de fato atualizada.
   */
  patchExecution(
    workspaceId: string,
    executionId: string,
    patch: ExecutionPatch,
    options?: PatchExecutionOptions,
  ): Promise<boolean>;
  insertLog(entry: FlowLogEntry): Promise<void>;
  /** Execucoes ativas (running|waiting|processing) de uma conversa — para resume/cancelAll. */
  findActiveByConversation(conversationId: string): Promise<LoadedExecution[]>;
}

/** Port de fila — re-enqueue do proximo step. */
export interface FlowQueuePort {
  enqueueStep(input: { workspaceId: string; executionId: string }): Promise<void>;
}

/** Port de outbound/conversa — efeitos dos handlers de output e system. */
export interface FlowOutboundPort {
  sendMessage(workspaceId: string, message: FlowOutboundMessage): Promise<void>;
  sendPresence(workspaceId: string, action: FlowPresenceAction): Promise<void>;
  setConversationAi(
    workspaceId: string,
    input: { conversationId: string; aiMode: 'on' | 'off' | 'paused'; agentId?: string | null },
  ): Promise<void>;
  setConversationStatus(
    workspaceId: string,
    input: { conversationId: string; status: string },
  ): Promise<void>;
}

/** Port HTTP (timeout/retry resolvidos aqui, fora dos handlers). */
export interface FlowHttpPort {
  request(input: FlowHttpRequest): Promise<FlowHttpResponse>;
}

export interface FlowLoggerPort {
  log(level: FlowLogLevel, message: string, fields?: Record<string, unknown>): void;
}

/** Mudança de estado de uma execução (F51 — monitoramento em tempo real no cockpit). */
export interface FlowExecutionEvent {
  readonly workspaceId: string;
  readonly executionId: string;
  readonly flowId: string;
  readonly conversationId: string | null;
  /** So estados PUBLICOS: `processing` (claim interno, F56-S13) nunca e emitido. */
  readonly status: FlowExecutionPublicStatus;
  /** Deadline do próximo passo quando `waiting`; null em running/terminal. */
  readonly nextStepAt: Date | null;
}

/**
 * Port de eventos de execução. A impl real (worker) publica no socket relay; o defaultEngine
 * não tem port (no-op). Best-effort por contrato: a impl NUNCA deve lançar — uma falha de
 * notificação não pode abortar um step de flow.
 */
export interface FlowEventsPort {
  executionChanged(event: FlowExecutionEvent): Promise<void> | void;
}

/** Conjunto completo de dependencias da engine. */
export interface FlowEngineDeps {
  readonly db: FlowDbPort;
  readonly queue: FlowQueuePort;
  readonly outbound: FlowOutboundPort;
  readonly http: FlowHttpPort;
  readonly logger: FlowLoggerPort;
  /** Notificação de mudança de estado (opcional). Wireada pelo worker; no-op no defaultEngine. */
  readonly events?: FlowEventsPort;
  /** relogio injetavel (testabilidade do WAITING/next_step_at). */
  now(): Date;
  /** override do resolvedor de handler (DI para testes); default = registry.getHandler. */
  resolveHandler?(nodeType: string): RegisteredFlowHandler | undefined;
}
