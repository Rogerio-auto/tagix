/**
 * Followup processor DURAVEL (CAMPAIGNS.md 8.4 + 14). Substitui o setTimeout do v1:
 * o agendamento vive em scheduled_followups (tabela) e SOBREVIVE a crash.
 */
import { Buffer } from 'node:buffer';
import { and, asc, eq, lte } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import { makeEnvelope, QUEUES } from '@hm/shared/mq';
import type { MqHandle } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';

type MqChannel = MqHandle['channel'];

const {
  campaigns,
  campaignFollowups,
  campaignRecipients,
  scheduledFollowups,
  contacts,
  conversations,
} = schema;

export const OUTBOUND_QUEUE = QUEUES.outbound;
export const OUTBOUND_JOB_TYPE = 'outbound.request';
export const FOLLOWUP_DRAIN_LOCK_KEY = 'hm:lock:scheduler:campaign-followups';
export const FOLLOWUP_DRAIN_LOCK_TTL_MS = 25000;
export const DEFAULT_FOLLOWUP_DRAIN_MS = 15000;
export const MAX_FOLLOWUP_ATTEMPTS = 5;

export interface FollowupEvent {
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly recipientId: string;
  readonly event: 'on_reply' | 'on_no_reply' | 'on_delivered';
}

export type ScheduleOutcome =
  | { readonly kind: 'scheduled'; readonly scheduledFollowupId: string }
  | { readonly kind: 'no_followup' }
  | { readonly kind: 'duplicate' };

export interface FollowupPorts {
  scheduleFollowup(event: FollowupEvent): Promise<ScheduleOutcome>;
  drainDue(now: Date): Promise<{ sent: number; failed: number }>;
}

export interface FollowupDeps {
  readonly ports: FollowupPorts;
  readonly logger: Logger;
}

export interface FollowupDbDeps {
  readonly channel: MqChannel;
  readonly logger: Logger;
}

export function createFollowupPorts(deps: FollowupDbDeps): FollowupPorts {
  return {
    async scheduleFollowup(event: FollowupEvent): Promise<ScheduleOutcome> {
      return withWorkspace(event.workspaceId, async (tx) => {
        const followupRows = await tx
          .select()
          .from(campaignFollowups)
          .where(
            and(
              eq(campaignFollowups.campaignId, event.campaignId),
              eq(campaignFollowups.triggerEvent, event.event),
              eq(campaignFollowups.isActive, true),
            ),
          )
          .orderBy(asc(campaignFollowups.position))
          .limit(1);
        const followup = followupRows[0];
        if (!followup) return { kind: 'no_followup' };

        const scheduledAt = new Date(Date.now() + followup.delayMinutes * 60000);
        const inserted = await tx
          .insert(scheduledFollowups)
          .values({
            workspaceId: event.workspaceId,
            campaignId: event.campaignId,
            recipientId: event.recipientId,
            followupId: followup.id,
            status: 'scheduled',
            scheduledAt,
          })
          .onConflictDoNothing({
            target: [scheduledFollowups.recipientId, scheduledFollowups.followupId],
          })
          .returning({ id: scheduledFollowups.id });
        const row = inserted[0];
        if (!row) return { kind: 'duplicate' };
        return { kind: 'scheduled', scheduledFollowupId: row.id };
      });
    },

    async drainDue(now: Date): Promise<{ sent: number; failed: number }> {
      const due = await getDb()
        .select({
          id: scheduledFollowups.id,
          workspaceId: scheduledFollowups.workspaceId,
          campaignId: scheduledFollowups.campaignId,
          recipientId: scheduledFollowups.recipientId,
          followupId: scheduledFollowups.followupId,
          attempts: scheduledFollowups.attempts,
        })
        .from(scheduledFollowups)
        .where(
          and(eq(scheduledFollowups.status, 'scheduled'), lte(scheduledFollowups.scheduledAt, now)),
        )
        .orderBy(asc(scheduledFollowups.scheduledAt))
        .limit(200);

      let sent = 0;
      let failed = 0;
      for (const item of due) {
        try {
          const ok = await withWorkspace(item.workspaceId, async (tx) => {
            const claimed = await tx
              .update(scheduledFollowups)
              .set({ status: 'processing', attempts: item.attempts + 1 })
              .where(
                and(
                  eq(scheduledFollowups.id, item.id),
                  eq(scheduledFollowups.status, 'scheduled'),
                ),
              )
              .returning({ id: scheduledFollowups.id });
            if (claimed.length === 0) return false;

            const followupRows = await tx
              .select()
              .from(campaignFollowups)
              .where(eq(campaignFollowups.id, item.followupId));
            const followup = followupRows[0];
            const recipientRows = await tx
              .select({ contactId: campaignRecipients.contactId })
              .from(campaignRecipients)
              .where(eq(campaignRecipients.id, item.recipientId));
            const recipient = recipientRows[0];
            const campaignRows = await tx
              .select({ channelId: campaigns.channelId })
              .from(campaigns)
              .where(eq(campaigns.id, item.campaignId));
            const campaign = campaignRows[0];
            if (!followup || !recipient || !campaign) {
              await tx
                .update(scheduledFollowups)
                .set({ status: 'failed', failedReason: 'missing_refs', processedAt: new Date() })
                .where(eq(scheduledFollowups.id, item.id));
              return false;
            }

            const contactRows = await tx
              .select({ phone: contacts.phone })
              .from(contacts)
              .where(eq(contacts.id, recipient.contactId));
            const phone = contactRows[0]?.phone ?? null;
            if (!phone) {
              await tx
                .update(scheduledFollowups)
                .set({ status: 'failed', failedReason: 'no_phone', processedAt: new Date() })
                .where(eq(scheduledFollowups.id, item.id));
              return false;
            }

            const convRows = await tx
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.channelId, campaign.channelId),
                  eq(conversations.remoteId, phone),
                ),
              );
            const conversationId = convRows[0]?.id ?? null;

            const job = {
              kind: 'template',
              channelId: campaign.channelId,
              conversationId: conversationId ?? '',
              messageId: 'followup-' + item.id,
              chatId: phone,
              templateName: followup.templateName,
              languageCode: followup.languageCode,
              components: followup.templateComponents ?? [],
            };
            const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, item.workspaceId, job);
            deps.channel.sendToQueue(OUTBOUND_QUEUE, Buffer.from(JSON.stringify(envelope)), {
              persistent: true,
              contentType: 'application/json',
            });

            await tx
              .update(scheduledFollowups)
              .set({ status: 'sent', processedAt: new Date() })
              .where(eq(scheduledFollowups.id, item.id));
            return true;
          });
          if (ok) sent += 1;
          else failed += 1;
        } catch (err: unknown) {
          failed += 1;
          await withWorkspace(item.workspaceId, (tx) =>
            tx
              .update(scheduledFollowups)
              .set(
                item.attempts + 1 >= MAX_FOLLOWUP_ATTEMPTS
                  ? { status: 'failed', failedReason: 'max_attempts', processedAt: new Date() }
                  : { status: 'scheduled' },
              )
              .where(eq(scheduledFollowups.id, item.id)),
          );
          deps.logger.error('campaign-followup: drain falhou', {
            id: item.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { sent, failed };
    },
  };
}

export interface RedisLike {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UNLOCK_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReleaseLock = () => Promise<void>;

export async function acquireSchedulerLock(
  redis: RedisLike,
  key: string,
  ttlMs: number,
): Promise<ReleaseLock | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await redis.eval(UNLOCK_LUA, 1, key, token);
  };
}

export interface FollowupSchedulerDeps extends FollowupDeps {
  readonly redis: RedisLike;
}

export async function runFollowupDrainTick(
  deps: FollowupSchedulerDeps,
  now: Date = new Date(),
): Promise<{ ran: boolean; sent: number; failed: number }> {
  const release = await acquireSchedulerLock(
    deps.redis,
    FOLLOWUP_DRAIN_LOCK_KEY,
    FOLLOWUP_DRAIN_LOCK_TTL_MS,
  );
  if (release === null) return { ran: false, sent: 0, failed: 0 };
  try {
    const res = await deps.ports.drainDue(now);
    deps.logger.info('campaign-followup: drain concluido', { ...res });
    return { ran: true, ...res };
  } finally {
    await release();
  }
}

export interface FollowupSchedulerHandle {
  stop(): Promise<void>;
}

export function followupDrainMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['CAMPAIGN_FOLLOWUP_DRAIN_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_FOLLOWUP_DRAIN_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FOLLOWUP_DRAIN_MS;
}

export function startFollowupDrainScheduler(
  deps: FollowupSchedulerDeps,
  options: { intervalMs?: number } = {},
): FollowupSchedulerHandle {
  const intervalMs = options.intervalMs ?? followupDrainMsFromEnv();
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runFollowupDrainTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('campaign-followup: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('campaign-followup scheduler iniciado', { intervalMs });
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export interface FollowupBootDeps {
  readonly channel: MqChannel;
  readonly redis: RedisLike;
  readonly logger: Logger;
}

export function startFollowupProcessor(
  deps: FollowupBootDeps,
  options: { intervalMs?: number } = {},
): { handle: FollowupSchedulerHandle; ports: FollowupPorts } {
  const ports = createFollowupPorts({ channel: deps.channel, logger: deps.logger });
  const handle = startFollowupDrainScheduler(
    { ports, redis: deps.redis, logger: deps.logger },
    options,
  );
  return { handle, ports };
}
