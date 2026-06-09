/**
 * @hm/agents-client — cliente HTTP tipado (Node) para o microsserviço Python
 * `agent-runtime` (FastAPI + LangGraph).
 *
 * O contrato de request/response é compartilhado via export OpenAPI do Python
 * (F2-S03). Aqui mora o cliente que a API Node e os workers usam para disparar
 * execuções de agente.
 */

import type { WorkspaceId, ConversationId } from '@hm/shared';

export interface RunAgentRequest {
  readonly workspaceId: WorkspaceId;
  readonly conversationId: ConversationId;
  readonly agentId: string;
  readonly input: string;
}

export interface RunAgentResult {
  readonly output: string;
  readonly toolCalls: number;
  readonly openrouterGenerationId: string | null;
}

export interface AgentsClientConfig {
  readonly baseUrl: string;
  readonly token: string;
}

export const AGENTS_CLIENT_PKG = '@hm/agents-client' as const;
