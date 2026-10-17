/**
 * Ciclo de vida da campanha como serviço de domínio (F73-S09; CAMPAIGNS.md §4 e §13;
 * COPILOTO.md §8 R6).
 *
 * Extraído de `routes/campaigns/lifecycle.ts` SEM mudar o comportamento da rota: `pause` e
 * `resume` são as mesmas transições (mesmos predicados, mesma ordem de locks, mesma trilha),
 * e a rota passa a delegar. Quem age é sempre um membro (`actor`); o Copiloto chama o mesmo
 * serviço com `via: 'copilot'` e o id da proposta na trilha (ADR-003 §6).
 *
 * `cancelCampaign` é NOVO e estrito, de propósito diferente do `DELETE /api/campaigns/:id`
 * (que usa `campaign.edit` e não confere o status — achado pré-existente, consertado em slot
 * próprio):
 *  - exige `campaign.cancel` do ator (confere aqui, não só na borda: o serviço é chamado por
 *    caminhos que não passam pelo `requireRole`);
 *  - só cancela a partir de `scheduled | running | paused` (CAS no UPDATE);
 *  - o trigger `trg_campaign_outbox_gate` (0095) descarta, na MESMA transação, os jobs de
 *    envio da campanha que ainda não saíram da outbox; aqui cancelamos também os follow-ups
 *    agendados;
 *  - devolve os números que a pessoa precisa ver: o que já saiu (não volta), o que deixou de
 *    sair e o custo já usado. O custo é `null`: hoje nenhum custo por campanha é registrado no
 *    banco (o envio da Meta não é precificado; ver F73-S07). Não inventamos número.
 */
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { can, type Role } from '@hm/shared';

const { campaigns, campaignRecipients, campaignDeliveries, scheduledFollowups, auditLogs } = schema;

export type CampaignRow = typeof campaigns.$inferSelect;

/** Quem age (sempre um membro; o Copiloto age com as permissões de quem pede). */
export interface CampaignActor {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
}

/** Origem da ação, gravada na trilha de domínio (`metadata.via`, `metadata.proposal_id`). */
export interface CampaignActionOrigin {
  readonly via?: 'copilot' | 'autopilot';
  readonly proposalId?: string | null;
}

/** Ação de ciclo de vida registrada pela pessoa (o worker registra as automáticas). */
export type MemberStatusAction =
  | 'campaign.started'
  | 'campaign.scheduled'
  | 'campaign.paused'
  | 'campaign.resumed'
  | 'campaign.cancelled';

/** Status a partir dos quais cada transição manual vale. */
export const PAUSABLE_STATUSES = ['running', 'scheduled'] as const;
export const RESUMABLE_STATUSES = ['paused'] as const;
export const CANCELLABLE_STATUSES = ['scheduled', 'running', 'paused'] as const;

/** Destinatários que ainda vão receber (o "agendadas" da tela e do Copiloto, F73-S07). */
const PENDING_RECIPIENT_STATUSES = ['pending', 'sending'] as const;
/** Entregas que já saíram (não voltam). */
const SENT_DELIVERY_STATUSES = ['sent', 'delivered', 'read'] as const;

export const CAMPAIGN_ENDED_MESSAGE =
  'O prazo final desta campanha já passou. Ajuste a data final ou duplique a campanha para enviar de novo.';

function originMetadata(origin: CampaignActionOrigin | undefined): Record<string, unknown> {
  if (!origin?.via) return {};
  return { via: origin.via, proposal_id: origin.proposalId ?? null };
}

/** Trilha da mudança de status (o detalhe da campanha mostra a última). */
export async function recordMemberStatusChange(
  tx: DbTx,
  actor: CampaignActor,
  campaignId: string,
  action: MemberStatusAction,
  reason: string,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLogs).values({
    workspaceId: actor.workspaceId,
    actorMemberId: actor.memberId,
    actorType: 'member',
    action,
    resourceType: 'campaign',
    resourceId: campaignId,
    metadata: { reason, message, ...extra },
  });
}

/** Prazo final já vencido em `now`? */
export function hasEnded(endAt: Date | null, now: Date): boolean {
  return endAt !== null && endAt.getTime() <= now.getTime();
}

// ─── Pausar ──────────────────────────────────────────────────────────────────────

export type PauseOutcome =
  | { readonly kind: 'paused'; readonly campaign: CampaignRow }
  | { readonly kind: 'bad_state'; readonly status: string }
  | { readonly kind: 'not_found' };

/** Pausa manual: só do que está enviando ou agendado (F58-S11). */
export async function pauseCampaign(
  tx: DbTx,
  actor: CampaignActor,
  campaignId: string,
  origin?: CampaignActionOrigin,
): Promise<PauseOutcome> {
  const [updated] = await tx
    .update(campaigns)
    .set({ status: 'paused', nextTickAt: null, updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), inArray(campaigns.status, [...PAUSABLE_STATUSES])))
    .returning();
  if (updated) {
    await recordMemberStatusChange(
      tx,
      actor,
      campaignId,
      'campaign.paused',
      'manual',
      'Pausada manualmente.',
      originMetadata(origin),
    );
    return { kind: 'paused', campaign: updated };
  }
  const [current] = await tx
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  return current ? { kind: 'bad_state', status: current.status } : { kind: 'not_found' };
}

// ─── Retomar ─────────────────────────────────────────────────────────────────────

export type ResumeOutcome =
  | { readonly kind: 'resumed'; readonly campaign: CampaignRow }
  | { readonly kind: 'bad_state'; readonly status: string }
  | { readonly kind: 'ended' }
  | { readonly kind: 'not_found' };

/** Retoma uma campanha pausada (volta a `scheduled` se o início ainda é futuro). */
export async function resumeCampaign(
  tx: DbTx,
  actor: CampaignActor,
  campaignId: string,
  origin?: CampaignActionOrigin,
): Promise<ResumeOutcome> {
  const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return { kind: 'not_found' };
  if (campaign.status !== 'paused') return { kind: 'bad_state', status: campaign.status };
  const now = new Date();
  if (hasEnded(campaign.endAt, now)) return { kind: 'ended' };

  // Recipients que estavam 'sending' voltam para pending (re-tentativa segura).
  // ANTES da linha da campanha: mesma ordem de locks do dispatch do worker
  // (recipient -> campanha), sem ciclo de espera com um envio em voo.
  await tx
    .update(campaignRecipients)
    .set({ status: 'pending' })
    .where(
      and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, 'sending')),
    );

  const startsInFuture = campaign.startAt ? campaign.startAt.getTime() > now.getTime() : false;
  const [updated] = await tx
    .update(campaigns)
    .set({
      status: startsInFuture ? 'scheduled' : 'running',
      nextTickAt: startsInFuture ? campaign.startAt : now,
      updatedAt: now,
    })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'paused')))
    .returning();
  if (!updated) return { kind: 'bad_state', status: 'changed' };
  await recordMemberStatusChange(
    tx,
    actor,
    campaignId,
    'campaign.resumed',
    startsInFuture ? 'resumed_scheduled' : 'resumed',
    startsInFuture ? 'Retomada. O envio começa sozinho na data de início.' : 'Envio retomado.',
    originMetadata(origin),
  );
  return { kind: 'resumed', campaign: updated };
}

// ─── Progresso (prévia e política do Copiloto, números do cancelamento) ──────────

export interface CampaignProgress {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly updatedAt: Date | null;
  readonly endAt: Date | null;
  /** Destinatários na campanha. */
  readonly recipients: number;
  /** Mensagens que já saíram (entregues/lidas incluídas). Não voltam. */
  readonly alreadySent: number;
  /** Destinatários que ainda iam receber (`pending`/`sending`). */
  readonly scheduled: number;
  /** Custo já usado. `null` = sem fonte de custo por campanha (estado atual do produto). */
  readonly costUsed: number | null;
}

async function countSent(tx: DbTx, campaignId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(campaignDeliveries)
    .where(
      and(
        eq(campaignDeliveries.campaignId, campaignId),
        inArray(campaignDeliveries.status, [...SENT_DELIVERY_STATUSES]),
      ),
    );
  return Number(row?.n ?? 0);
}

async function countRecipients(
  tx: DbTx,
  campaignId: string,
): Promise<{ total: number; pending: number }> {
  const [row] = await tx
    .select({
      total: count(),
      pending: sql<number>`count(*) filter (where ${inArray(campaignRecipients.status, [
        ...PENDING_RECIPIENT_STATUSES,
      ])})`.mapWith(Number),
    })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, campaignId));
  return { total: Number(row?.total ?? 0), pending: Number(row?.pending ?? 0) };
}

/** Números de uma campanha (sob a RLS da transação). `null` = não existe neste workspace. */
export async function loadCampaignProgress(
  tx: DbTx,
  campaignId: string,
): Promise<CampaignProgress | null> {
  const [campaign] = await tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      updatedAt: campaigns.updatedAt,
      endAt: campaigns.endAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return null;
  const [sent, recipients] = await Promise.all([
    countSent(tx, campaignId),
    countRecipients(tx, campaignId),
  ]);
  return {
    ...campaign,
    recipients: recipients.total,
    alreadySent: sent,
    scheduled: recipients.pending,
    costUsed: null,
  };
}

// ─── Cancelar (estrito) ──────────────────────────────────────────────────────────

export interface CancelNumbers {
  /** Mensagens que já saíram e não voltam. */
  readonly already_sent: number;
  /**
   * Envios que deixaram de acontecer: destinatários que ainda iam receber (`pending`), jobs
   * da campanha descartados da outbox pelo trigger e follow-ups agendados cancelados.
   */
  readonly cancelled_scheduled: number;
  /** Jobs que já estavam no broker no instante do cancelamento (não dá para recolher). */
  readonly in_flight: number;
  /** Custo já usado. `null`: não há fonte de custo por campanha no banco hoje. */
  readonly cost_used: number | null;
}

export type CancelOutcome =
  | ({ readonly kind: 'cancelled'; readonly campaign: CampaignRow } & CancelNumbers)
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'bad_state'; readonly status: string }
  | { readonly kind: 'not_found' };

/** Lê `{ dropped, inFlight }` da trilha que o trigger `campaign_outbox_gate` grava. */
function readGateMetadata(value: unknown): { dropped: number; inFlight: number } {
  const rec = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { dropped: num(rec['dropped']), inFlight: num(rec['inFlight']) };
}

/**
 * Cancela a campanha de vez. Estrito: `campaign.cancel` e status `scheduled|running|paused`.
 * Tudo numa transação: o UPDATE (CAS), o descarte dos jobs pela trigger, os follow-ups e a
 * trilha. Rollback leva tudo junto.
 */
export async function cancelCampaign(
  tx: DbTx,
  actor: CampaignActor,
  campaignId: string,
  origin?: CampaignActionOrigin,
): Promise<CancelOutcome> {
  if (!can(actor.role, 'campaign.cancel')) return { kind: 'forbidden' };

  // Contagens ANTES do UPDATE: o que ainda ia sair é o que deixa de sair.
  const before = await loadCampaignProgress(tx, campaignId);
  if (!before) return { kind: 'not_found' };
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(before.status)) {
    return { kind: 'bad_state', status: before.status };
  }
  const [pendingRow] = await tx
    .select({ n: count() })
    .from(campaignRecipients)
    .where(
      and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, 'pending')),
    );

  const now = new Date();
  const [updated] = await tx
    .update(campaigns)
    .set({ status: 'cancelled', nextTickAt: null, updatedAt: now })
    .where(and(eq(campaigns.id, campaignId), inArray(campaigns.status, [...CANCELLABLE_STATUSES])))
    .returning();
  if (!updated) {
    const [current] = await tx
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    return current ? { kind: 'bad_state', status: current.status } : { kind: 'not_found' };
  }

  // O trigger da 0095 registrou o que descartou da outbox NESTA transação (now() é o instante
  // da transação). A API não lê a outbox (0086/0091): lê a trilha que o trigger deixou.
  const [gated] = await tx
    .select({ metadata: auditLogs.metadata })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, 'campaign'),
        eq(auditLogs.resourceId, campaignId),
        eq(auditLogs.action, 'campaign.outbox_gated'),
        sql`${auditLogs.createdAt} = now()`,
      ),
    )
    .limit(1);
  const gate = readGateMetadata(gated?.metadata);

  const followups = await tx
    .update(scheduledFollowups)
    .set({ status: 'cancelled', processedAt: now, failedReason: 'campaign_cancelled' })
    .where(
      and(
        eq(scheduledFollowups.campaignId, campaignId),
        eq(scheduledFollowups.status, 'scheduled'),
      ),
    )
    .returning({ id: scheduledFollowups.id });

  const numbers: CancelNumbers = {
    already_sent: before.alreadySent,
    cancelled_scheduled: Number(pendingRow?.n ?? 0) + gate.dropped + followups.length,
    in_flight: gate.inFlight,
    cost_used: before.costUsed,
  };
  await recordMemberStatusChange(
    tx,
    actor,
    campaignId,
    'campaign.cancelled',
    'manual',
    'Cancelada. O que já saiu não volta; o que ainda ia sair não sai mais.',
    { from: before.status, ...numbers, ...originMetadata(origin) },
  );
  return { kind: 'cancelled', campaign: updated, ...numbers };
}
