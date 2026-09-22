/**
 * Repositório de leads de anúncios (F69-S03).
 *
 * Tudo que é do workspace roda sob a transação recebida (RLS). As duas exceções —
 * `resolveSourcesForPage` e `listActiveSources` — atendem o webhook e a
 * reconciliação, que não têm workspace, e passam pelas funções `SECURITY DEFINER` da
 * migration 0080, que devolvem só identificadores.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, type DbTx } from '../client';
import {
  leadAdSources,
  leadAdSubmissions,
  type LeadAdDelivery,
  type LeadAdSource,
  type LeadAdSubmissionStatus,
  type LeadConsentEvidence,
} from '../schema/lead_ads';

async function upsertSource(
  tx: DbTx,
  input: {
    workspaceId: string;
    connectionId: string;
    pageId: string;
    pageName: string | null;
    /** Default `webhook`: só quem assinou a página entrega em segundos (F69-S13). */
    delivery?: LeadAdDelivery;
    /** Por que a assinatura não foi possível — guardado para a tela explicar. */
    subscribeError?: string | null;
    now: Date;
  },
): Promise<LeadAdSource> {
  const delivery = input.delivery ?? 'webhook';
  const subscribeError = input.subscribeError ?? null;
  const [linha] = await tx
    .insert(leadAdSources)
    .values({
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      pageId: input.pageId,
      pageName: input.pageName,
      status: 'active',
      delivery,
      subscribeError,
      // Só carimba a assinatura quando ela de fato aconteceu.
      subscribedAt: delivery === 'webhook' ? input.now : null,
    })
    .onConflictDoUpdate({
      target: [leadAdSources.workspaceId, leadAdSources.pageId],
      set: {
        connectionId: input.connectionId,
        pageName: input.pageName,
        status: 'active',
        delivery,
        subscribeError,
        subscribedAt: delivery === 'webhook' ? input.now : null,
        updatedAt: input.now,
      },
    })
    .returning();
  if (linha === undefined) throw new Error('lead_ad_sources: upsert não devolveu linha.');
  return linha;
}

async function getSource(tx: DbTx, workspaceId: string, id: string): Promise<LeadAdSource | null> {
  const [linha] = await tx
    .select()
    .from(leadAdSources)
    .where(and(eq(leadAdSources.workspaceId, workspaceId), eq(leadAdSources.id, id)))
    .limit(1);
  return linha ?? null;
}

/**
 * A assinatura funcionou: a página passa a entregar em segundos (F69-S13).
 *
 * Promove a fonte que já existe em vez de recadastrar — a página mantém id, histórico de leads e a
 * janela já conferida, então ligar o webhook não reprocessa nem duplica nada.
 */
async function promoteSourceToWebhook(
  tx: DbTx,
  workspaceId: string,
  id: string,
  now: Date,
): Promise<boolean> {
  const linhas = await tx
    .update(leadAdSources)
    .set({ delivery: 'webhook', subscribeError: null, subscribedAt: now, updatedAt: now })
    .where(and(eq(leadAdSources.workspaceId, workspaceId), eq(leadAdSources.id, id)))
    .returning({ id: leadAdSources.id });
  return linhas.length > 0;
}

async function listSources(tx: DbTx, workspaceId: string): Promise<LeadAdSource[]> {
  return tx
    .select()
    .from(leadAdSources)
    .where(eq(leadAdSources.workspaceId, workspaceId))
    .orderBy(leadAdSources.createdAt);
}

async function deactivateSource(tx: DbTx, workspaceId: string, id: string, now: Date): Promise<boolean> {
  const linhas = await tx
    .update(leadAdSources)
    .set({ status: 'inactive', updatedAt: now })
    .where(and(eq(leadAdSources.workspaceId, workspaceId), eq(leadAdSources.id, id)))
    .returning({ id: leadAdSources.id });
  return linhas.length > 0;
}

async function markReconciled(tx: DbTx, workspaceId: string, sourceId: string, at: Date): Promise<void> {
  await tx
    .update(leadAdSources)
    .set({ lastReconciledAt: at, updatedAt: at })
    .where(and(eq(leadAdSources.workspaceId, workspaceId), eq(leadAdSources.id, sourceId)));
}

export interface ResolvedLeadSource {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly connectionId: string;
}

/** Webhook: fontes ativas desta página, em qualquer workspace. Só identificadores. */
async function resolveSourcesForPage(pageId: string): Promise<ResolvedLeadSource[]> {
  const linhas = await getDb().execute<{
    workspace_id: string;
    source_id: string;
    connection_id: string;
  }>(sql`select workspace_id, source_id, connection_id from public.resolve_lead_ad_sources(${pageId})`);
  return linhas.map((l) => ({
    workspaceId: l.workspace_id,
    sourceId: l.source_id,
    connectionId: l.connection_id,
  }));
}

export interface ActiveLeadSource extends ResolvedLeadSource {
  readonly pageId: string;
  readonly lastReconciledAt: Date | null;
}

/** Reconciliação: todas as fontes ativas. Só identificadores e o carimbo. */
async function listActiveSources(): Promise<ActiveLeadSource[]> {
  const linhas = await getDb().execute<{
    workspace_id: string;
    source_id: string;
    connection_id: string;
    page_id: string;
    last_reconciled_at: string | Date | null;
  }>(
    sql`select workspace_id, source_id, connection_id, page_id, last_reconciled_at from public.list_active_lead_ad_sources()`,
  );
  return linhas.map((l) => ({
    workspaceId: l.workspace_id,
    sourceId: l.source_id,
    connectionId: l.connection_id,
    pageId: l.page_id,
    lastReconciledAt: l.last_reconciled_at === null ? null : new Date(l.last_reconciled_at),
  }));
}

/**
 * Reserva o lead para processamento.
 *
 * `processed` devolve `alreadyProcessed: true` e quem chama para. Qualquer outro
 * estado (novo, recebido de uma tentativa que caiu, falha) segue — é o que torna o
 * retry e a reconciliação seguros sem duplicar contato nem card.
 */
async function claimSubmission(
  tx: DbTx,
  input: {
    workspaceId: string;
    sourceId: string | null;
    leadgenId: string;
    pageId: string;
    formId: string | null;
    adId: string | null;
  },
): Promise<{ id: string; alreadyProcessed: boolean }> {
  const [nova] = await tx
    .insert(leadAdSubmissions)
    .values({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      leadgenId: input.leadgenId,
      pageId: input.pageId,
      formId: input.formId,
      adId: input.adId,
    })
    .onConflictDoNothing({ target: [leadAdSubmissions.workspaceId, leadAdSubmissions.leadgenId] })
    .returning({ id: leadAdSubmissions.id });
  if (nova !== undefined) return { id: nova.id, alreadyProcessed: false };

  const [existente] = await tx
    .select({ id: leadAdSubmissions.id, status: leadAdSubmissions.status })
    .from(leadAdSubmissions)
    .where(
      and(
        eq(leadAdSubmissions.workspaceId, input.workspaceId),
        eq(leadAdSubmissions.leadgenId, input.leadgenId),
      ),
    )
    .limit(1);
  if (existente === undefined) throw new Error('lead_ad_submissions: conflito sem linha existente.');
  return { id: existente.id, alreadyProcessed: existente.status === 'processed' };
}

/**
 * Trava a linha do lead até o fim da transação e devolve o estado atual.
 *
 * Webhook e reconciliação podem pegar o mesmo lead ao mesmo tempo. Os dois buscam na
 * Meta (fora de transação), mas só um grava: o segundo espera a trava, relê
 * `processed` e para. Sem isto, os dois criariam contato e card.
 */
async function lockSubmission(
  tx: DbTx,
  workspaceId: string,
  id: string,
): Promise<LeadAdSubmissionStatus | null> {
  const [linha] = await tx
    .select({ status: leadAdSubmissions.status })
    .from(leadAdSubmissions)
    .where(and(eq(leadAdSubmissions.workspaceId, workspaceId), eq(leadAdSubmissions.id, id)))
    .for('update');
  return linha?.status ?? null;
}

async function completeSubmission(
  tx: DbTx,
  input: {
    workspaceId: string;
    id: string;
    leadCreatedAt: Date | null;
    formId: string | null;
    adId: string | null;
    answers: Record<string, string[]>;
    consent: LeadConsentEvidence;
    contactId: string;
    conversationId: string | null;
    dealId: string | null;
    now: Date;
  },
): Promise<void> {
  await tx
    .update(leadAdSubmissions)
    .set({
      status: 'processed' satisfies LeadAdSubmissionStatus,
      leadCreatedAt: input.leadCreatedAt,
      formId: input.formId,
      adId: input.adId,
      answers: input.answers,
      consentResponses: input.consent,
      contactId: input.contactId,
      conversationId: input.conversationId,
      dealId: input.dealId,
      error: null,
      attempts: sql`${leadAdSubmissions.attempts} + 1`,
      processedAt: input.now,
    })
    .where(and(eq(leadAdSubmissions.workspaceId, input.workspaceId), eq(leadAdSubmissions.id, input.id)));
}

async function failSubmission(
  tx: DbTx,
  input: { workspaceId: string; id: string; error: string },
): Promise<void> {
  await tx
    .update(leadAdSubmissions)
    .set({
      status: 'failed' satisfies LeadAdSubmissionStatus,
      error: input.error.slice(0, 500),
      attempts: sql`${leadAdSubmissions.attempts} + 1`,
    })
    .where(and(eq(leadAdSubmissions.workspaceId, input.workspaceId), eq(leadAdSubmissions.id, input.id)));
}

/** O que a tela mostra de cada lead recente. Sem respostas: a tela de fontes não é CRM. */
export interface LeadSubmissionSummary {
  readonly id: string;
  readonly pageId: string;
  readonly formId: string | null;
  readonly status: LeadAdSubmissionStatus;
  readonly error: string | null;
  readonly attempts: number;
  readonly conversationId: string | null;
  readonly dealId: string | null;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
}

async function listRecentSubmissions(
  tx: DbTx,
  workspaceId: string,
  limit: number,
): Promise<LeadSubmissionSummary[]> {
  return tx
    .select({
      id: leadAdSubmissions.id,
      pageId: leadAdSubmissions.pageId,
      formId: leadAdSubmissions.formId,
      status: leadAdSubmissions.status,
      error: leadAdSubmissions.error,
      attempts: leadAdSubmissions.attempts,
      conversationId: leadAdSubmissions.conversationId,
      dealId: leadAdSubmissions.dealId,
      createdAt: leadAdSubmissions.createdAt,
      processedAt: leadAdSubmissions.processedAt,
    })
    .from(leadAdSubmissions)
    .where(eq(leadAdSubmissions.workspaceId, workspaceId))
    .orderBy(desc(leadAdSubmissions.createdAt))
    .limit(limit);
}

export const leadAdsRepo = {
  upsertSource,
  getSource,
  promoteSourceToWebhook,
  listSources,
  deactivateSource,
  markReconciled,
  resolveSourcesForPage,
  listActiveSources,
  claimSubmission,
  lockSubmission,
  completeSubmission,
  failSubmission,
  listRecentSubmissions,
} as const;
