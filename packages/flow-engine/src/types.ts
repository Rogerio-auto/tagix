/**
 * Tipos nucleares da engine deterministica de flows (FLOW_BUILDER.md §3).
 *
 * FlowNode/FlowEdge espelham o shape persistido em `flows.nodes`/`flows.edges` (jsonb).
 * A forma forte de `node.data` e validada por cada handler (FlowHandler.schema), nao aqui.
 */
import type { z } from 'zod';

/** Um no do grafo. `data` e opaco no nucleo; cada handler valida o proprio shape. */
export interface FlowNode<TData = unknown> {
  readonly id: string;
  readonly type: string;
  readonly data: TData;
  /** posicao no canvas (so UI; engine ignora). */
  readonly position?: { x: number; y: number };
}

/** Uma aresta dirigida. `sourceHandle` casa com o `edgeHandle` retornado pelo handler. */
export interface FlowEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly sourceHandle?: string | null;
  readonly targetHandle?: string | null;
}

/** Resultado de um handler (FLOW_BUILDER.md §3.4). */
export type FlowHandlerResult =
  | { status: 'SUCCESS'; edgeHandle?: string; variables?: Record<string, unknown> }
  | { status: 'WAITING'; nextStepAt: string; variables?: Record<string, unknown> }
  | { status: 'ERROR'; error: string };

/**
 * Contrato fixo de todo handler (consumido por F4-S04/05/06). Os handlers nunca tocam
 * infra direto: tudo passa pelos ports de `FlowExecutionContext`.
 */
export interface FlowHandler<TNodeData = unknown> {
  readonly schema: z.ZodType<TNodeData>;
  execute(node: FlowNode<TNodeData>, ctx: FlowExecutionContext): Promise<FlowHandlerResult>;
}

/**
 * Handler com o tipo de dados apagado, como armazenado na registry. Evita problemas de
 * variancia (o campo `schema` poe TNodeData em posicao covariante). O dispatcher valida
 * `node.data` via `schema.parse` antes de chamar `execute`.
 */
export type RegisteredFlowHandler = {
  readonly schema: z.ZodType<unknown>;
  execute(node: FlowNode<unknown>, ctx: FlowExecutionContext): Promise<FlowHandlerResult>;
};

/**
 * Tipo de midia enviavel por um flow. Espelha `outboundMediaKindSchema` do worker
 * outbound (`apps/workers/src/outbound/job.ts`) e o dominio de `messages.type`.
 */
export type FlowOutboundMediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

/**
 * Mensagem outbound emitida por um handler (message/interactive/meta_flow/external_notify).
 *
 * Contrato rico (F31-S01): cobre texto, midia (imagem/video/documento via
 * `mediaStorageKey` + `mediaType` MIME + `caption`) e audio (`audioMessageKind`:
 * `voice` = nota de voz | `audio_file` = arquivo encaminhado). O publisher real
 * resolve `mediaStorageKey` -> URL publica temporaria no envio. Todos os campos
 * de midia sao opcionais: handlers de texto seguem inalterados.
 */
export interface FlowOutboundMessage {
  readonly conversationId: string;
  /** Texto da mensagem (ja interpolado pelo handler). */
  readonly text?: string;
  /** Chave do objeto no storage; resolvida para URL publica temporaria no envio. */
  readonly mediaStorageKey?: string;
  /** MIME do objeto de midia (ex.: `image/png`, `video/mp4`, `application/pdf`). */
  readonly mediaType?: string;
  /**
   * Tipo de midia explicito. Se ausente, e derivado de `audioMessageKind` (audio)
   * ou do prefixo de `mediaType` (image/video/audio/document).
   */
  readonly mediaKind?: FlowOutboundMediaKind;
  /** Legenda da midia (imagem/video/documento). */
  readonly caption?: string;
  /** Audio: nota de voz (`voice`) vs arquivo de audio encaminhado (`audio_file`). */
  readonly audioMessageKind?: 'voice' | 'audio_file';
  /** payload interactive/meta cru, repassado ao adapter do canal. */
  readonly interactivePayload?: Record<string, unknown>;
}

/** Indicador de presenca (typing/recording) antes de enviar. */
export interface FlowPresenceAction {
  readonly conversationId: string;
  readonly presence: 'typing' | 'recording';
  readonly durationMs: number;
}

/**
 * Ports testaveis expostos aos handlers. A implementacao real e wireada no `index.ts`
 * (DB sob RLS, MQ outbound, relogio); os testes injetam fakes. Mantem os handlers puros.
 */
export interface FlowExecutionContext {
  readonly workspaceId: string;
  readonly executionId: string;
  readonly flowId: string;
  readonly conversationId: string | null;
  readonly contactId: string | null;
  /** variaveis mutaveis da execucao (`flow_executions.variables`). */
  readonly variables: Record<string, unknown>;
  /** publica mensagem outbound (handlers de output). */
  sendMessage(message: FlowOutboundMessage): Promise<void>;
  /** dispara presenca (typing/recording). */
  sendPresence(action: FlowPresenceAction): Promise<void>;
  /** muda ai_mode/agent_id da conversa (ai_action handler). */
  setConversationAi(input: {
    aiMode: 'on' | 'off' | 'paused';
    agentId?: string | null;
  }): Promise<void>;
  /** muda status da conversa (change_status handler). */
  setConversationStatus(status: string): Promise<void>;
  /** HTTP externo (http_request/external_notify) com timeout/retry resolvido pelo port. */
  httpRequest(input: FlowHttpRequest): Promise<FlowHttpResponse>;
  /** registra log estruturado (alem do flow_logs do dispatcher). */
  log(level: FlowLogLevel, message: string, payload?: Record<string, unknown>): void;
  /** relogio injetavel (testabilidade). */
  now(): Date;
}

export type FlowLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface FlowHttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

export interface FlowHttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}
