/**
 * @hm/flow-engine — engine de execução de flows (custom, NÃO agentic).
 *
 * Flows são automações visuais disparadas por evento. Distinto do runtime de
 * agentes (LangGraph): aqui não há LLM no loop — é um grafo de handlers
 * determinísticos. Os 14 handlers entram em F-FlowBuilder (FLOW_BUILDER.md).
 */

export type FlowNodeKind =
  | 'trigger'
  | 'send_message'
  | 'condition'
  | 'delay'
  | 'http_request'
  | 'set_variable';

export interface FlowNode {
  readonly id: string;
  readonly kind: FlowNodeKind;
  readonly next: readonly string[];
}

export const FLOW_ENGINE_PKG = '@hm/flow-engine' as const;
