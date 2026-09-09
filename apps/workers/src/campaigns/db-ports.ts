/**
 * Implementacao das CampaignTickPorts contra @hm/db + RLS (CAMPAIGNS.md 8).
 *
 * enqueueDelivery e o coracao da maquina de estados do recipient — TUDO numa
 * unica transacao RLS-escopada (withWorkspace = BEGIN + set local role):
 *
 *   1. CLAIM ATOMICO: UPDATE ... SET status='sending' WHERE status='pending'
 *      AND next_step_at devido. Zero linhas => outro tick levou o recipient
 *      (outcome `skipped`). Espelha o claim de scheduled_followups (followups.ts).
 *   2. IDEMPOTENCIA: insere campaign_deliveries com idempotencyKey UNIQUE;
 *      conflito => o step JA foi despachado antes -> NAO reenvia, mas AVANCA o
 *      recipient (cura a linha que ficaria presa se um crash matasse o processo
 *      entre o envio e a transicao).
 *   3. DRIP (CAMP-03): apos publicar em hm.q.outbound, `advanceAfterDispatch`
 *      devolve o recipient a `pending` com next_step_at = now + delaySeconds do
 *      PROXIMO step — ou o marca `completed` quando os steps acabam (CAMP-04).
 *
 * O que era o bug: o recipient virava `sending` e ninguem o tirava de la;
 * `delaySeconds` nunca era lido; a campanha nunca chegava a `completed`; e o
 * teto diario (`daily_limit`/`messages_sent_today`) existia so no schema.
 */
import { Buffer } from 'node:buffer';
import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { consentRepo, decryptSecret, getDb, schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import { GraphClient, fetchChannelQuality, type ChannelHealth } from '@hm/channels';
import { decideOutbound, isMarketCode } from '@hm/shared';
import type { ChannelKind, MarketCode, OutboundDecision } from '@hm/shared';
import { makeEnvelope, QUEUES } from '@hm/shared/mq';
import type { MqHandle } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import type { CampaignErrorAction } from '@hm/channels';
import type {
  CampaignQuota,
  CampaignTickPorts,
  DispatchOutcome,
  PendingDispatch,
  ReapResult,
  RunningCampaign,
} from './tick';
import type { SendWindows } from './windows';
import {
  advanceAfterDispatch,
  afterDispatchFailure,
  campaignIsExhausted,
  evaluateDailyQuota,
  MAX_DISPATCH_ATTEMPTS,
  STALE_CLAIM_MS,
  type CampaignStepRef,
  type RecipientTransition,
} from './steps/state';

type MqChannel = MqHandle['channel'];

const {
  campaigns,
  campaignSteps,
  campaignRecipients,
  campaignDeliveries,
  channels,
  channelSecrets,
  contacts,
  conversations,
  messages,
} = schema;

export const OUTBOUND_QUEUE = QUEUES.outbound;
export const OUTBOUND_JOB_TYPE = 'outbound.request';

export interface CampaignDbDeps {
  readonly channel: MqChannel;
  readonly logger: Logger;
  readonly graph?: GraphClient;
}

async function loadChannelToken(
  tx: DbTx,
  channelId: string,
): Promise<{ accessToken: string; phoneNumberId: string } | null> {
  const [channel] = await tx.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return null;
  const [secret] = await tx
    .select()
    .from(channelSecrets)
    .where(eq(channelSecrets.channelId, channelId));
  const accessToken = secret ? decryptSecret(secret.accessTokenEnc, secret.keyVersion) : '';
  return { accessToken, phoneNumberId: channel.phoneNumberId ?? '' };
}

/** Steps da campanha na ordem de posicao (o indice do array = indice do passo). */
async function loadSteps(tx: DbTx, campaignId: string): Promise<CampaignStepRef[]> {
  const rows = await tx
    .select({
      id: campaignSteps.id,
      position: campaignSteps.position,
      delaySeconds: campaignSteps.delaySeconds,
    })
    .from(campaignSteps)
    .where(eq(campaignSteps.campaignId, campaignId))
    .orderBy(asc(campaignSteps.position));
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    delaySeconds: r.delaySeconds,
  }));
}

/** Aplica a transicao pos-dispatch (drip ou terminal) no recipient. */
async function applyTransition(
  tx: DbTx,
  recipientId: string,
  t: RecipientTransition,
): Promise<void> {
  await tx
    .update(campaignRecipients)
    .set({
      status: t.status,
      lastStepIndex: t.lastStepIndex,
      lastStepAt: t.lastStepAt,
      nextStepAt: t.nextStepAt,
      completedAt: t.completedAt,
      attempts: t.attempts,
    })
    .where(eq(campaignRecipients.id, recipientId));
}

/** Recipient com dado inviavel (sem telefone, step sumido): terminal `failed`. */
async function failRecipient(tx: DbTx, recipientId: string, reason: string): Promise<void> {
  await tx
    .update(campaignRecipients)
    .set({ status: 'failed', failedReason: reason, nextStepAt: null })
    .where(eq(campaignRecipients.id, recipientId));
}

/** SQL do "recipient esta devido agora" (next_step_at nulo = devido). */
function isDue(now: Date) {
  return or(isNull(campaignRecipients.nextStepAt), lte(campaignRecipients.nextStepAt, now));
}

export function createCampaignTickPorts(deps: CampaignDbDeps): CampaignTickPorts {
  const graph = deps.graph ?? new GraphClient();

  return {
    async listDueCampaigns(now: Date): Promise<RunningCampaign[]> {
      const rows = await getDb()
        .select({
          id: campaigns.id,
          workspaceId: campaigns.workspaceId,
          channelId: campaigns.channelId,
          sendWindows: campaigns.sendWindows,
          rateLimitPerMinute: campaigns.rateLimitPerMinute,
        })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.status, 'running'),
            or(isNull(campaigns.nextTickAt), lte(campaigns.nextTickAt, now)),
          ),
        );

      const out: RunningCampaign[] = [];
      for (const r of rows) {
        const metricRows = await withWorkspace(r.workspaceId, (tx) =>
          tx
            .select({ deliveryRate: schema.campaignMetrics.deliveryRate })
            .from(schema.campaignMetrics)
            .where(eq(schema.campaignMetrics.campaignId, r.id)),
        );
        const m = metricRows[0];
        out.push({
          id: r.id,
          workspaceId: r.workspaceId,
          channelId: r.channelId,
          sendWindows: r.sendWindows as SendWindows | null,
          rateLimitPerMinute: r.rateLimitPerMinute,
          deliveryRate: m && m.deliveryRate != null ? Number(m.deliveryRate) : null,
        });
      }
      return out;
    },

    async fetchQuality(campaign: RunningCampaign): Promise<ChannelHealth> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const creds = await loadChannelToken(tx, campaign.channelId);
        if (!creds || !creds.phoneNumberId) {
          return { qualityRating: 'UNKNOWN', tierLimit: 250 };
        }
        return fetchChannelQuality(graph, {
          phoneNumberId: creds.phoneNumberId,
          accessToken: creds.accessToken,
        });
      });
    },

    async reapRecipients(campaign: RunningCampaign, now: Date): Promise<ReapResult> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
        const staleClaim = and(
          eq(campaignRecipients.campaignId, campaign.id),
          eq(campaignRecipients.status, 'sending'),
          // Date dentro de fragmento `sql` cru nao tem type-mapper no postgres.js
          // (ERR_INVALID_ARG_TYPE): manda ISO + cast explicito.
          sql`coalesce(${campaignRecipients.lastStepAt}, ${campaignRecipients.createdAt}) < ${cutoff.toISOString()}::timestamptz`,
        );

        // (a) claim estagnado que ja esgotou as tentativas -> falha honesta.
        const exhausted = await tx
          .update(campaignRecipients)
          .set({
            status: 'failed',
            failedReason: 'max_dispatch_attempts',
            nextStepAt: null,
          })
          .where(and(staleClaim, gte(campaignRecipients.attempts, MAX_DISPATCH_ATTEMPTS)))
          .returning({ id: campaignRecipients.id });

        // (b) demais claims estagnados voltam a fila (devidos agora).
        const recovered = await tx
          .update(campaignRecipients)
          .set({ status: 'pending', nextStepAt: now })
          .where(staleClaim)
          .returning({ id: campaignRecipients.id });

        // (c) CAMP-04: pendente que ja consumiu todos os steps -> terminal.
        const steps = await loadSteps(tx, campaign.id);
        const finalized = await tx
          .update(campaignRecipients)
          .set({ status: 'completed', completedAt: now, nextStepAt: null })
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.status, 'pending'),
              sql`coalesce(${campaignRecipients.lastStepIndex}, -1) + 1 >= ${steps.length}`,
            ),
          )
          .returning({ id: campaignRecipients.id });

        return {
          recovered: exhausted.length + recovered.length,
          finalized: finalized.length,
        };
      });
    },

    async ensureDailyQuota(campaign: RunningCampaign, now: Date): Promise<CampaignQuota> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const rows = await tx
          .select({
            dailyLimit: campaigns.dailyLimit,
            messagesSentToday: campaigns.messagesSentToday,
            lastDailyResetAt: campaigns.lastDailyResetAt,
            timezone: campaigns.timezone,
          })
          .from(campaigns)
          .where(eq(campaigns.id, campaign.id));
        const row = rows[0];
        if (!row) {
          // Campanha sumiu no meio do tick: nada a enviar.
          return { remaining: 0, resetsAt: new Date(now.getTime() + 60 * 60 * 1000) };
        }

        const quota = evaluateDailyQuota(
          {
            dailyLimit: row.dailyLimit,
            messagesSentToday: row.messagesSentToday,
            lastDailyResetAt: row.lastDailyResetAt,
            timezone: row.timezone,
          },
          now,
        );

        if (quota.needsReset) {
          await tx
            .update(campaigns)
            .set({ messagesSentToday: 0, lastDailyResetAt: now })
            .where(eq(campaigns.id, campaign.id));
        }

        return { remaining: quota.remaining, resetsAt: quota.resetsAt };
      });
    },

    async recordDailyUsage(campaign: RunningCampaign, sent: number, now: Date): Promise<void> {
      if (sent <= 0) return;
      await withWorkspace(campaign.workspaceId, (tx) =>
        tx
          .update(campaigns)
          .set({
            messagesSentToday: sql`${campaigns.messagesSentToday} + ${sent}`,
            lastDailyResetAt: sql`coalesce(${campaigns.lastDailyResetAt}, ${now.toISOString()}::timestamptz)`,
          })
          .where(eq(campaigns.id, campaign.id)),
      );
    },

    async pendingRecipients(
      campaign: RunningCampaign,
      limit: number,
      now: Date,
    ): Promise<PendingDispatch[]> {
      if (limit <= 0) return [];
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const recipients = await tx
          .select({
            recipientId: campaignRecipients.id,
            contactId: campaignRecipients.contactId,
            lastStepIndex: campaignRecipients.lastStepIndex,
          })
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.status, 'pending'),
              isDue(now),
            ),
          )
          .orderBy(
            asc(
              sql`coalesce(${campaignRecipients.nextStepAt}, ${campaignRecipients.createdAt})`,
            ),
          )
          .limit(limit);

        const steps = await loadSteps(tx, campaign.id);

        const out: PendingDispatch[] = [];
        for (const r of recipients) {
          const nextIdx = (r.lastStepIndex ?? -1) + 1;
          const step = steps[nextIdx];
          // Sem proximo step: o reaper (c) fecha esse recipient no proprio tick.
          if (!step) continue;
          out.push({
            recipientId: r.recipientId,
            contactId: r.contactId,
            stepId: step.id,
            stepIndex: nextIdx,
          });
        }
        return out;
      });
    },

    /**
     * F59-S05 — portao de consentimento antes de enfileirar.
     *
     * Campanha e sempre `marketing`: e o produtor que carrega a exigencia de
     * consentimento (AGENCIA_PLAN §4.4). Checar aqui evita enfileirar mil
     * mensagens que seriam recusadas uma a uma no worker outbound.
     */
    async checkConsent(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      now: Date,
    ): Promise<OutboundDecision> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const [canal] = await tx
          .select({ provider: channels.provider })
          .from(channels)
          .where(eq(channels.id, campaign.channelId))
          .limit(1);

        const [ws] = await tx
          .select({ market: schema.workspaces.market })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, campaign.workspaceId))
          .limit(1);

        const [contato] = await tx
          .select({ timezone: schema.contacts.timezone })
          .from(schema.contacts)
          .where(eq(schema.contacts.id, dispatch.contactId))
          .limit(1);

        if (!canal || !ws || !contato) {
          return {
            allowed: false,
            reason: 'suppressed',
            message: 'Canal, workspace ou contato nao encontrado — envio recusado por seguranca.',
            usedFallbackTimezone: true,
            timezone: 'UTC',
          } satisfies OutboundDecision;
        }

        const market: MarketCode = isMarketCode(ws.market) ? ws.market : 'BR';
        const channel = canal.provider as ChannelKind;

        const consent = await consentRepo.getSnapshot(tx, {
          workspaceId: campaign.workspaceId,
          contactId: dispatch.contactId,
          channel,
          purpose: 'marketing',
        });

        return decideOutbound({
          market,
          channel,
          purpose: 'marketing',
          consent,
          contactTimezone: contato.timezone ?? null,
          // Canais de campanha de hoje (Meta/WAHA) nao exigem registro externo.
          // Quando o SMS entrar (F60-F), este valor vem do estado do canal.
          channelRegistration: 'none',
          now,
        });
      });
    },

    /**
     * F59-S05 — tira o recipient da execucao por supressao/falta de consentimento.
     * Distinto de `invalid` (dado ruim): aqui o dado esta certo e a pessoa
     * simplesmente nao pode receber. Reusa o mesmo caminho de `failed` para que
     * o motivo apareca no relatorio da campanha.
     */
    async denyRecipient(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      reason: string,
    ): Promise<void> {
      await withWorkspace(campaign.workspaceId, async (tx) => {
        await failRecipient(tx, dispatch.recipientId, `consent_${reason}`);
      });
    },

    async enqueueDelivery(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      idempotencyKey: string,
      now: Date,
    ): Promise<DispatchOutcome> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        // (1) Claim atomico: so avanca quem ainda esta pending E devido.
        const claimed = await tx
          .update(campaignRecipients)
          .set({
            status: 'sending',
            attempts: sql`${campaignRecipients.attempts} + 1`,
          })
          .where(
            and(
              eq(campaignRecipients.id, dispatch.recipientId),
              eq(campaignRecipients.status, 'pending'),
              isDue(now),
            ),
          )
          .returning({ attempts: campaignRecipients.attempts });
        const claim = claimed[0];
        if (!claim) return { kind: 'skipped' };
        const attempts = claim.attempts;

        const steps = await loadSteps(tx, campaign.id);

        const [step] = await tx
          .select()
          .from(campaignSteps)
          .where(eq(campaignSteps.id, dispatch.stepId));
        if (!step) {
          await failRecipient(tx, dispatch.recipientId, 'step_missing');
          return { kind: 'invalid', reason: 'step_missing' };
        }

        const [contact] = await tx
          .select({ phone: contacts.phone })
          .from(contacts)
          .where(eq(contacts.id, dispatch.contactId));
        if (!contact || !contact.phone) {
          await failRecipient(tx, dispatch.recipientId, 'missing_phone');
          return { kind: 'invalid', reason: 'missing_phone' };
        }
        const phone = contact.phone;

        // (2) Idempotencia: a UNIQUE decide se este step ja saiu alguma vez.
        const inserted = await tx
          .insert(campaignDeliveries)
          .values({
            workspaceId: campaign.workspaceId,
            campaignId: campaign.id,
            recipientId: dispatch.recipientId,
            stepId: dispatch.stepId,
            idempotencyKey,
            status: 'queued',
          })
          .onConflictDoNothing({ target: campaignDeliveries.idempotencyKey })
          .returning({ id: campaignDeliveries.id });
        const insertedRow = inserted[0];
        if (!insertedRow) {
          // Step ja despachado: NAO reenvia, mas destrava o recipient (avanca o
          // drip) — senao ele voltaria eternamente ao mesmo passo.
          await applyTransition(
            tx,
            dispatch.recipientId,
            advanceAfterDispatch(steps, dispatch.stepIndex, now),
          );
          return { kind: 'duplicate' };
        }
        const deliveryId = insertedRow.id;

        const [existingConv] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.channelId, campaign.channelId),
              eq(conversations.remoteId, phone),
            ),
          );
        let conversationId: string;
        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          const convRows = await tx
            .insert(conversations)
            .values({
              workspaceId: campaign.workspaceId,
              channelId: campaign.channelId,
              contactId: dispatch.contactId,
              remoteId: phone,
              status: 'open',
            })
            .returning({ id: conversations.id });
          const conv = convRows[0];
          if (!conv) {
            await applyFailure(tx, dispatch.recipientId, attempts, now, 'conversation_failed');
            return { kind: 'error', errorCode: '131008' };
          }
          conversationId = conv.id;
        }

        const messageRows = await tx
          .insert(messages)
          .values({
            workspaceId: campaign.workspaceId,
            conversationId,
            direction: 'outbound',
            senderType: 'system',
            type: 'template',
            content: step.templateName,
            viewStatus: 'pending',
            metadata: { campaignId: campaign.id, deliveryId },
          })
          .returning({ id: messages.id });
        const message = messageRows[0];
        if (!message) {
          await applyFailure(tx, dispatch.recipientId, attempts, now, 'message_failed');
          return { kind: 'error', errorCode: '131008' };
        }
        const messageId = message.id;

        await tx
          .update(campaignDeliveries)
          .set({ messageId })
          .where(eq(campaignDeliveries.id, deliveryId));

        // (3) Drip: proximo step agendado em now + delaySeconds (ou terminal).
        await applyTransition(
          tx,
          dispatch.recipientId,
          advanceAfterDispatch(steps, dispatch.stepIndex, now),
        );

        const job = {
          kind: 'template',
          channelId: campaign.channelId,
          conversationId,
          messageId,
          chatId: phone,
          templateName: step.templateName,
          languageCode: step.languageCode,
          components: step.templateComponents ?? [],
        };
        const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, campaign.workspaceId, job);
        deps.channel.sendToQueue(OUTBOUND_QUEUE, Buffer.from(JSON.stringify(envelope)), {
          persistent: true,
          contentType: 'application/json',
        });

        return { kind: 'enqueued' };
      });
    },

    async settleCampaign(campaign: RunningCampaign, now: Date): Promise<boolean> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const rows = await tx
          .select({
            total: sql<number>`count(*)`.mapWith(Number),
            active: sql<number>`count(*) filter (where ${campaignRecipients.status} in ('pending','sending'))`.mapWith(
              Number,
            ),
          })
          .from(campaignRecipients)
          .where(eq(campaignRecipients.campaignId, campaign.id));
        const row = rows[0];
        if (!row) return false;
        if (!campaignIsExhausted({ total: row.total, active: row.active })) return false;

        const updated = await tx
          .update(campaigns)
          .set({ status: 'completed', nextTickAt: null, updatedAt: now })
          .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'running')))
          .returning({ id: campaigns.id });
        return updated.length > 0;
      });
    },

    async pauseCampaign(campaignId: string, reason: string): Promise<void> {
      const rows = await getDb()
        .select({ workspaceId: campaigns.workspaceId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      const row = rows[0];
      if (!row) return;
      await withWorkspace(row.workspaceId, (tx) =>
        tx
          .update(campaigns)
          .set({ status: 'paused', nextTickAt: null, updatedAt: new Date() })
          .where(eq(campaigns.id, campaignId)),
      );
      deps.logger.warn('campaigns: campanha pausada', { campaignId, reason });
    },

    async scheduleNextTick(campaignId: string, at: Date): Promise<void> {
      const rows = await getDb()
        .select({ workspaceId: campaigns.workspaceId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      const row = rows[0];
      if (!row) return;
      await withWorkspace(row.workspaceId, (tx) =>
        tx.update(campaigns).set({ nextTickAt: at }).where(eq(campaigns.id, campaignId)),
      );
    },

    async applyErrorAction(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      action: CampaignErrorAction,
    ): Promise<void> {
      await withWorkspace(campaign.workspaceId, async (tx) => {
        switch (action.kind) {
          case 'invalidate_recipient':
          case 'needs_reengagement':
          case 'count_block':
            await tx
              .update(campaignRecipients)
              .set({ status: 'failed', failedReason: action.reason, nextStepAt: null })
              .where(eq(campaignRecipients.id, dispatch.recipientId));
            break;
          case 'fail_delivery':
            await tx
              .update(campaignDeliveries)
              .set({ status: 'failed', errorMessage: action.reason, failedAt: new Date() })
              .where(
                and(
                  eq(campaignDeliveries.campaignId, campaign.id),
                  eq(campaignDeliveries.recipientId, dispatch.recipientId),
                  eq(campaignDeliveries.stepId, dispatch.stepId),
                ),
              );
            break;
          case 'pause_campaign':
            break;
        }
      });
    },
  };
}

/**
 * Falha transitoria no despacho: reagenda o MESMO step com backoff exponencial
 * (ou marca failed ao esgotar as tentativas). Nunca deixa o recipient preso em
 * `sending` — que era exatamente o estado morto do CAMP-03.
 */
async function applyFailure(
  tx: DbTx,
  recipientId: string,
  attempts: number,
  now: Date,
  reason: string,
): Promise<void> {
  const t = afterDispatchFailure(attempts, now, reason);
  await tx
    .update(campaignRecipients)
    .set({
      status: t.status,
      nextStepAt: t.nextStepAt,
      failedReason: t.failedReason,
    })
    .where(eq(campaignRecipients.id, recipientId));
}
