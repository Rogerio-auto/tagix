/**
 * Validacao de flow pre-publicacao (FLOW_BUILDER.md §9.3). STUB do scaffold S02.
 *
 * S07 PREENCHE este arquivo (exatamente-1-trigger, nodes inalcancaveis, ciclos, variaveis
 * desconhecidas, schema por node.type via handlerRegistry). A assinatura publica
 * (`validateFlow` + `FlowValidationIssue`/`FlowValidationResult`) e contrato de S02 —
 * consumida pela API (F4-S08) e pelo editor (F4-S10/S11). Nao mudar a assinatura.
 */
import type { FlowEdge, FlowNode } from './types';

export type FlowValidationSeverity = 'error' | 'warning';

export interface FlowValidationIssue {
  readonly severity: FlowValidationSeverity;
  readonly message: string;
  /** node ao qual o problema se refere, quando aplicavel. */
  readonly nodeId?: string;
  /** codigo estavel para i18n/teste (ex.: `trigger_count`, `unreachable`, `cycle`). */
  readonly code: string;
}

export interface FlowValidationResult {
  readonly valid: boolean;
  readonly issues: readonly FlowValidationIssue[];
}

export interface FlowValidationInput {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
}

/**
 * STUB S02: retorna sempre `valid: true`. S07 implementa as regras reais.
 * Mantido permissivo de proposito para o pacote compilar e o editor nao bloquear
 * publicacao antes de S07 entrar.
 */
export function validateFlow(_input: FlowValidationInput): FlowValidationResult {
  return { valid: true, issues: [] };
}
