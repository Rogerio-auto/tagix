/**
 * Trilha do motor de propostas (ADR-004 §7; ADR-003 §6).
 *
 * Uma linha em `audit_logs` por transição, NA MESMA transação da transição: se a trilha não
 * grava, a transição também não. Convenção:
 *
 *   actor_type              `copilot` ou `autopilot` (pela origem da proposta)
 *   actor_member_id         membro cujas permissões foram usadas (o aprovador, na aprovação;
 *                           quem desfez, no desfazer; `null` nas transições do sistema)
 *   requested_by_member_id  quem pediu
 *   copilot_proposal_id     a proposta
 *   copilot_turn_id         o turno que a gerou (se houver)
 *   metadata                { capability, risk_level, from, to, counts, ... } — SEM PII
 *
 * `action` é `copilot.proposal.<evento>`: o status de destino, ou `adjusted`,
 * `stop_requested`, `undo_started`, `retried` quando a transição não muda o status.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type CopilotProposalRow, type CopilotProposalStatus, type DbTx } from '@hm/db';

export const PROPOSAL_AUDIT_RESOURCE = 'copilot_proposal' as const;

export type ProposalAuditEvent =
  | CopilotProposalStatus
  | 'adjusted'
  | 'stop_requested'
  | 'undo_started'
  | 'retried';

export interface ProposalAuditInput {
  readonly proposal: CopilotProposalRow;
  readonly event: ProposalAuditEvent;
  /** Status de origem (`null` na criação). */
  readonly from: CopilotProposalStatus | null;
  /** Membro cujas permissões foram usadas; `null` = sistema (varredura). */
  readonly actorMemberId: string | null;
  readonly counts?: Record<string, number>;
  /** Campos extras de metadata (ex.: `undo_key`, `reason`). Nunca PII. */
  readonly extra?: Record<string, string | number | boolean | null>;
}

export async function recordProposalAudit(tx: DbTx, input: ProposalAuditInput): Promise<void> {
  const { proposal } = input;
  await tx.insert(schema.auditLogs).values({
    workspaceId: proposal.workspaceId,
    actorType: proposal.source === 'autopilot' ? 'autopilot' : 'copilot',
    actorMemberId: input.actorMemberId,
    action: `copilot.proposal.${input.event}`,
    resourceType: PROPOSAL_AUDIT_RESOURCE,
    resourceId: proposal.id,
    requestedByMemberId: proposal.requestedByMemberId,
    copilotProposalId: proposal.id,
    copilotTurnId: proposal.turnId,
    metadata: {
      capability: proposal.capability,
      risk_level: proposal.riskLevel,
      from: input.from,
      to: proposal.status,
      version: proposal.version,
      ...(input.counts ? { counts: input.counts } : {}),
      ...(proposal.blockedReason ? { blocked_reason: proposal.blockedReason } : {}),
      ...input.extra,
    },
  });
}

/**
 * Chave de idempotência do desfazer já registrada para a proposta (a trilha é a fonte: a linha
 * `undo_started` grava `undo_key`). `null` = ninguém começou a desfazer.
 */
export async function findUndoKey(tx: DbTx, proposalId: string): Promise<string | null> {
  const a = schema.auditLogs;
  const [row] = await tx
    .select({ key: sql<string | null>`${a.metadata} ->> 'undo_key'` })
    .from(a)
    .where(
      and(
        eq(a.copilotProposalId, proposalId),
        eq(a.action, 'copilot.proposal.undo_started'),
        sql`${a.workspaceId} = app_current_workspace()`,
      ),
    )
    .orderBy(desc(a.createdAt))
    .limit(1);
  return row?.key ?? null;
}

/**
 * "Tentar de novo" já feito para a proposta: a chave usada e a proposta nova (a trilha é a fonte,
 * como no desfazer). `null` = nenhum.
 */
export async function findRetry(
  tx: DbTx,
  proposalId: string,
): Promise<{ readonly key: string | null; readonly retryProposalId: string | null } | null> {
  const a = schema.auditLogs;
  const [row] = await tx
    .select({
      key: sql<string | null>`${a.metadata} ->> 'retry_key'`,
      retryProposalId: sql<string | null>`${a.metadata} ->> 'retry_proposal_id'`,
    })
    .from(a)
    .where(
      and(
        eq(a.copilotProposalId, proposalId),
        eq(a.action, 'copilot.proposal.retried'),
        sql`${a.workspaceId} = app_current_workspace()`,
      ),
    )
    .orderBy(desc(a.createdAt))
    .limit(1);
  return row ?? null;
}
