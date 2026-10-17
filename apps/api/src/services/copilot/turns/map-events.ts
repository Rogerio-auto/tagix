/**
 * Eventos internos do runtime → contrato público do SSE (COPILOTO.md §5.3, §5.4; P5).
 *
 * Função de estado pura (sem IO): recebe cada `CopilotRuntimeEvent` já validado e devolve o
 * que sai para o navegador, acumulando o que o turno precisa gravar no fim.
 *
 * Regras (o modelo NUNCA escreve na tela fora do veredito):
 * - `status{tool_key}` → `status{phase, label}` com o rótulo do CATÁLOGO da ferramenta
 *   registrada. Chave que o registro não conhece (o modelo inventou) não gera status.
 * - `tool_call_completed` → o `public_event` do ENVELOPE que o próprio Node gerou no
 *   callback (`tool_result`, `action_*`). Um `tool_result` cujo `result_id` diverge do
 *   `result_id` do envelope é descartado (envelope incoerente não vira cartão).
 * - `verdict_delta` → repassado (é o veredito em streaming).
 * - `final` → `data_refs` filtrados pelos `result_id` VISTOS neste turno: referência
 *   inventada pelo modelo some.
 * - `iteration_exceeded` → só marca o turno (o runtime ainda fecha com `final`).
 * - `error{code}` → código público fechado (`COPILOT_ERROR_CODES`); desconhecido = `internal`.
 */
import {
  COPILOT_STREAM_VERSION,
  ToolResultCardSchema,
  statusLabelFor,
  type CopilotAnswerBlocks,
  type CopilotErrorCode,
  type CopilotRuntimeEvent,
  type CopilotStreamEvent,
  type RuntimeFinalEvent,
  type ToolResultCard,
} from '@hm/shared';
import type { CopilotToolDefinition } from '../../../internal/copilot/core/registry';

/** Cartões guardados na mensagem (o contrato aceita até 20). */
export const PERSISTED_CARDS_MAX = 20;

export type MappedStep =
  | { readonly kind: 'emit'; readonly event: CopilotStreamEvent }
  | {
      readonly kind: 'final';
      readonly final: RuntimeFinalEvent;
      readonly blocks: CopilotAnswerBlocks;
    }
  | { readonly kind: 'error'; readonly code: CopilotErrorCode; readonly runtimeCode: string }
  | {
      readonly kind: 'none';
      readonly reason:
        | 'unknown_tool'
        | 'no_public_event'
        | 'incoherent_envelope'
        | 'iteration_exceeded';
    };

export interface TurnAccumulator {
  /** Veredito recebido até agora (para gravar o parcial num cancelamento). */
  verdict: string;
  readonly cards: ToolResultCard[];
  readonly seenResultIds: Set<string>;
  /** Propostas citadas pelos eventos de ação, em ordem. */
  readonly proposalIds: string[];
  iterationExceeded: boolean;
  /** Eventos públicos emitidos (métrica). */
  emitted: number;
}

/** Código do runtime → código público. Aberto do lado do runtime, fechado do lado público. */
export function publicErrorCode(runtimeCode: string): CopilotErrorCode {
  switch (runtimeCode) {
    case 'timeout':
      return 'timeout';
    case 'iteration_limit':
    case 'iteration_exceeded':
    case 'tool_call_limit':
      return 'iteration_limit';
    case 'runtime_unavailable':
    case 'provider_error':
    case 'model_error':
    case 'model_unavailable':
    case 'upstream_error':
      return 'runtime_unavailable';
    default:
      return 'internal';
  }
}

export interface EventMapper {
  readonly state: TurnAccumulator;
  map(event: CopilotRuntimeEvent): MappedStep;
}

export function createEventMapper(tools: readonly CopilotToolDefinition[]): EventMapper {
  const byKey = new Map(tools.map((t) => [t.key, t] as const));
  const state: TurnAccumulator = {
    verdict: '',
    cards: [],
    seenResultIds: new Set(),
    proposalIds: [],
    iterationExceeded: false,
    emitted: 0,
  };
  const emit = (event: CopilotStreamEvent): MappedStep => {
    state.emitted++;
    return { kind: 'emit', event };
  };

  function map(event: CopilotRuntimeEvent): MappedStep {
    switch (event.type) {
      case 'status': {
        const tool = byKey.get(event.tool_key);
        if (!tool) return { kind: 'none', reason: 'unknown_tool' };
        const { phase, label } = statusLabelFor(tool.capability, tool.area);
        return emit({ v: COPILOT_STREAM_VERSION, type: 'status', phase, label });
      }
      case 'tool_call_completed': {
        const publicEvent = event.envelope.public_event;
        if (!publicEvent) return { kind: 'none', reason: 'no_public_event' };
        if (publicEvent.type === 'tool_result') {
          const envelopeId = event.envelope.result_id;
          if (envelopeId !== undefined && envelopeId !== publicEvent.result_id) {
            return { kind: 'none', reason: 'incoherent_envelope' };
          }
          state.seenResultIds.add(publicEvent.result_id);
          if (state.cards.length < PERSISTED_CARDS_MAX) {
            // Cartão persistido = o evento sem o envelope do stream (`v`, `type`).
            const { v, type, ...card } = publicEvent;
            void v;
            void type;
            state.cards.push(ToolResultCardSchema.parse(card));
          }
          return emit(publicEvent);
        }
        state.proposalIds.push(
          publicEvent.type === 'action_proposed'
            ? publicEvent.proposal.id
            : publicEvent.proposal_id,
        );
        return emit(publicEvent);
      }
      case 'verdict_delta':
        state.verdict += event.text;
        return emit({ v: COPILOT_STREAM_VERSION, type: 'verdict_delta', text: event.text });
      case 'final': {
        const blocks: CopilotAnswerBlocks = {
          ...event.blocks,
          data_refs: event.blocks.data_refs.filter((id) => state.seenResultIds.has(id)),
        };
        return { kind: 'final', final: event, blocks };
      }
      case 'iteration_exceeded':
        state.iterationExceeded = true;
        return { kind: 'none', reason: 'iteration_exceeded' };
      case 'error':
        return { kind: 'error', code: publicErrorCode(event.code), runtimeCode: event.code };
    }
  }

  return { state, map };
}
