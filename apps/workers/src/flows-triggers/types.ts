/**
 * Trigger dispatcher inbound (F4-S13). Conecta mensagens/eventos inbound a engine de flows:
 * avalia flows ATIVOS cujo trigger casa e dispara `triggerFlow`; e retoma execucoes em
 * `waiting_for_response` quando o contato responde. So inbound dispara triggers (secao 5.1).
 */

/** Mensagem inbound minima que o dispatcher precisa avaliar. */
export interface InboundMessageInfo {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly contactId: string | null;
  readonly channelId: string;
  readonly content: string | null;
  readonly type: string;
  readonly fromContact: boolean;
}

/** Flow ativo carregado para avaliacao de trigger. */
export interface ActiveFlow {
  readonly id: string;
  readonly workspaceId: string;
  readonly triggerType: string;
  readonly triggerConfig: Record<string, unknown>;
  readonly channelIds: readonly string[] | null;
}

/** Porta de banco: carrega flows ativos por tipo de trigger (RLS). */
export interface FlowsQueryPort {
  findActiveByTriggerTypes(
    workspaceId: string,
    triggerTypes: readonly string[],
  ): Promise<ActiveFlow[]>;
}

/** Porta da engine (subset da API publica de @hm/flow-engine). */
export interface FlowEnginePort {
  triggerFlow(input: {
    workspaceId: string;
    flowId: string;
    conversationId?: string;
    contactId?: string;
    triggerData?: Record<string, unknown>;
    triggeredBy: 'manual' | 'automatic' | 'api';
  }): Promise<{ executionId: string }>;
  resumeFlowWithResponse(input: {
    conversationId: string;
    responseType: string;
    responseContent: string;
  }): Promise<void>;
}
