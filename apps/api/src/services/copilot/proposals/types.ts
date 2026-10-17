/**
 * Tipos do motor de propostas (F73-S05; ADR-004).
 *
 * O motor é injetável de ponta a ponta: executores, emissor de socket, notificador e relógio
 * entram por `ProposalEngineDeps`. Em produção, `createProposalEngineDeps()` liga os reais; nos
 * testes, os fakes.
 */
import type { CopilotProposalStatus } from '@hm/db';
import type { Logger } from '@hm/logger';
import type { CopilotProposalUpdatedPayload, ProposalDTO } from '@hm/shared';
import type { CapabilityExecutor } from '../../../internal/copilot/core/executor-types';
import type { NotifiableEvent } from '../../notifications';

/** Executores por capacidade (um por capacidade; duplicado lança no boot). */
export interface ExecutorRegistry {
  get(capability: string): CapabilityExecutor | undefined;
  list(): readonly CapabilityExecutor[];
}

/** Emissão de `copilot:proposal_updated` para as salas `member:<id>` (best-effort). */
export type ProposalUpdateEmitter = (input: {
  readonly workspaceId: string;
  readonly memberIds: readonly string[];
  readonly payload: CopilotProposalUpdatedPayload;
}) => Promise<void>;

/** Notificação pela cascata existente (`copilot_aprovacao`). Best-effort. */
export type ProposalNotifier = (event: NotifiableEvent) => Promise<unknown>;

export interface ProposalEngineDeps {
  readonly executors: ExecutorRegistry;
  readonly emit: ProposalUpdateEmitter;
  readonly notify: ProposalNotifier;
  readonly now: () => Date;
  readonly logger: Logger;
  /** Intervalo mínimo entre eventos de progresso de uma proposta (ms). Default 250. */
  readonly progressThrottleMs?: number;
}

/**
 * Códigos de erro estáveis da API de propostas (o web lê `error`). O status HTTP vai junto:
 * 402 só leitura · 403 sem permissão · 404 não existe ou não é visível (sem oráculo) ·
 * 409 estado · 410 janela vencida · 422 entrada inválida para o estado.
 */
export const PROPOSAL_ERROR_STATUS = {
  not_found: 404,
  forbidden: 403,
  subscription_inactive: 402,
  budget: 403,
  capability_disabled: 403,
  already_confirmed: 409,
  stale_proposal: 409,
  not_undoable: 409,
  not_confirmable: 409,
  not_cancellable: 409,
  not_adjustable: 409,
  nothing_to_retry: 409,
  not_blocked_by_role: 409,
  policy_blocked: 409,
  proposal_expired: 410,
  undo_window_closed: 410,
  ack_required: 422,
  invalid_adjustment: 422,
  invalid_approver: 422,
  executor_unavailable: 409,
} as const;
export type ProposalErrorCode = keyof typeof PROPOSAL_ERROR_STATUS;

/** Mensagens pt-BR curtas, sem dado de negócio. */
export const PROPOSAL_ERROR_MESSAGES: Record<ProposalErrorCode, string> = {
  not_found: 'Proposta não encontrada.',
  forbidden: 'Sem permissão para esta ação.',
  subscription_inactive: 'A empresa está em modo só leitura. Mudanças estão desativadas.',
  budget: 'O orçamento do Copiloto chegou ao limite para ações.',
  capability_disabled: 'Esta ação está desligada para o seu papel nas configurações do Copiloto.',
  already_confirmed: 'Esta proposta já foi confirmada.',
  stale_proposal: 'A proposta mudou desde que você a abriu. Revise de novo.',
  not_undoable: 'Esta ação não pode ser desfeita.',
  not_confirmable: 'Esta proposta não pode mais ser confirmada.',
  not_cancellable: 'Esta proposta não pode mais ser cancelada.',
  not_adjustable: 'Esta proposta não pode mais ser ajustada.',
  nothing_to_retry: 'Não há itens para tentar de novo.',
  not_blocked_by_role: 'Só uma proposta bloqueada pelo papel pode ir para aprovação.',
  policy_blocked: 'A checagem de política bloqueou esta ação.',
  proposal_expired: 'A proposta expirou. Peça de novo ao Copiloto.',
  undo_window_closed: 'O prazo para desfazer terminou.',
  ack_required: 'Confirme que revisou a prévia antes de executar.',
  invalid_adjustment: 'Ajuste inválido para esta proposta.',
  invalid_approver: 'Esta pessoa não pode aprovar esta ação.',
  executor_unavailable: 'Esta ação não está disponível agora.',
};

/** Falha de serviço: vira `{ error, message, proposal? }` com o status do código. */
export interface ProposalFailure {
  readonly ok: false;
  readonly error: ProposalErrorCode;
  /** Estado atual, quando ajuda a interface (ex.: `stale_proposal`). */
  readonly proposal?: ProposalDTO;
}

export function fail(error: ProposalErrorCode, proposal?: ProposalDTO): ProposalFailure {
  return proposal ? { ok: false, error, proposal } : { ok: false, error };
}

/** Status em que a proposta já passou do confirmar (o replay com a mesma chave devolve 200). */
export const POST_CONFIRM_STATUSES: readonly CopilotProposalStatus[] = [
  'confirmed',
  'executing',
  'completed',
  'partially_completed',
  'failed',
  'undone',
  'partially_undone',
];

/** Status finais da execução (de onde se desfaz). */
export const UNDOABLE_STATUSES: readonly CopilotProposalStatus[] = [
  'completed',
  'partially_completed',
];

/** Prazo de confirmação por nível (ADR-004 §1). */
export const PROPOSAL_TTL_SECONDS = { 3: 15 * 60, 4: 10 * 60 } as const;
/** Pedido de aprovação (spec §5.2): 72 h. */
export const APPROVAL_TTL_SECONDS = 72 * 3600;
/** Janela de desfazer (ADR-004 §4). */
export const UNDO_WINDOW_SECONDS = { copilot: 24 * 3600, autopilot: 7 * 24 * 3600 } as const;
