/**
 * @hm/agents-client — cliente HTTP tipado (Node) para o microsserviço Python
 * `agent-runtime` (FastAPI + LangGraph).
 *
 * Contrato request/response em Zod (`./types`), espelhando o schema
 * FastAPI/Pydantic do runtime (`AGENTS_LANGGRAPH.md` §2, §3.1, §10). A API Node
 * e os workers usam `createAgentsClient({ baseUrl, token })` para disparar
 * execuções de agente e consumir o stream de eventos tipados.
 */

export {
  createAgentsClient,
  type AgentsClient,
  type AgentsClientConfig,
  type RunOptions,
} from './client';

export {
  AgentRuntimeError,
  type AgentRuntimeErrorKind,
  type AgentRuntimeErrorOptions,
} from './errors';

export {
  // Schemas Zod (fonte da verdade do contrato — contract tests S05).
  AgentRunRequestSchema,
  AgentStreamEventSchema,
  ChatMessageSchema,
  ChatRoleSchema,
  HealthResponseSchema,
  PolicySnapshotSchema,
  ToolDescriptorSchema,
  UsageSchema,
  // Tipos inferidos.
  type AgentRunRequest,
  type AgentRunRequestParsed,
  type AgentStreamEvent,
  type AgentFinalEvent,
  type AgentErrorEvent,
  type ChatMessage,
  type ChatRole,
  type HealthResponse,
  type PolicySnapshot,
  type ToolDescriptor,
  type Usage,
} from './types';

export const AGENTS_CLIENT_PKG = '@hm/agents-client' as const;
