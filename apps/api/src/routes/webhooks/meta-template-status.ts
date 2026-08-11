import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace, type DbTx } from '@hm/db';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export interface MetaTemplateStatusUpdate {
  readonly wabaId: string;
  readonly externalId?: string;
  readonly name?: string;
  readonly language?: string;
  readonly status?: string;
  readonly rejectionReason?: string;
  readonly deleted: boolean;
  readonly staleReason?: 'missing_identity' | 'missing_status';
}

/** Parser puro e tolerante do campo `message_template_status_update`. */
export function parseMetaTemplateStatusUpdates(
  body: Record<string, unknown>,
): readonly MetaTemplateStatusUpdate[] {
  const updates: MetaTemplateStatusUpdate[] = [];
  const entries = Array.isArray(body['entry']) ? body['entry'] : [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const wabaId = text(entry['id']);
    if (!wabaId) continue;
    const changes = Array.isArray(entry['changes']) ? entry['changes'] : [];
    for (const change of changes) {
      if (!isRecord(change) || change['field'] !== 'message_template_status_update') continue;
      const value = isRecord(change['value']) ? change['value'] : {};
      const externalId = text(value['message_template_id']) ?? text(value['id']);
      const name = text(value['message_template_name']) ?? text(value['name']);
      const language = text(value['message_template_language']) ?? text(value['language']);
      const status = text(value['event']) ?? text(value['status']);
      const rejectionReason = text(value['reason']) ?? text(value['rejection_reason']);
      const hasIdentity = externalId !== undefined || (name !== undefined && language !== undefined);
      updates.push({
        wabaId,
        ...(externalId === undefined ? {} : { externalId }),
        ...(name === undefined ? {} : { name }),
        ...(language === undefined ? {} : { language }),
        ...(status === undefined ? {} : { status }),
        ...(rejectionReason === undefined ? {} : { rejectionReason }),
        deleted: status?.toUpperCase() === 'DELETED',
        ...(!hasIdentity
          ? { staleReason: 'missing_identity' as const }
          : status === undefined
            ? { staleReason: 'missing_status' as const }
            : {}),
      });
    }
  }
  return updates;
}

export interface TemplateWebhookChannel {
  readonly id: string;
  readonly workspaceId: string;
}

export interface TemplateStatusDeps {
  readonly resolveChannels: (wabaId: string) => Promise<readonly TemplateWebhookChannel[]>;
  readonly mutateWorkspace: <T>(
    workspaceId: string,
    fn: (tx: DbTx) => Promise<T>,
  ) => Promise<T>;
  readonly now: () => Date;
}

/** Único lookup privilegiado: descobre tenant/canal; nunca lê segredos. */
export async function resolveTemplateWebhookChannels(
  wabaId: string,
): Promise<readonly TemplateWebhookChannel[]> {
  const rows = await getDb().execute<Record<string, unknown> & TemplateWebhookChannel>(sql`
    SELECT workspace_id AS "workspaceId", channel_id AS "id"
    FROM public.resolve_meta_template_channels(${wabaId})
  `);
  return Array.from(rows);
}

const defaultDeps: TemplateStatusDeps = {
  resolveChannels: resolveTemplateWebhookChannels,
  mutateWorkspace: withWorkspace,
  now: () => new Date(),
};

async function markStale(
  tx: DbTx,
  channel: TemplateWebhookChannel,
  now: Date,
  reason: string,
): Promise<void> {
  await tx
    .insert(schema.channelMessageTemplateSyncStates)
    .values({
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      syncStatus: 'stale',
      lastError: reason,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.channelMessageTemplateSyncStates.channelId,
      set: { syncStatus: 'stale', lastError: reason, updatedAt: now },
    });
}

async function applyOne(
  tx: DbTx,
  channel: TemplateWebhookChannel,
  update: MetaTemplateStatusUpdate,
  now: Date,
): Promise<void> {
  if (update.staleReason || update.status === undefined) {
    await markStale(tx, channel, now, update.staleReason ?? 'missing_status');
    return;
  }
  const identity = update.externalId
    ? eq(schema.channelMessageTemplates.externalId, update.externalId)
    : update.name && update.language
      ? and(
          eq(schema.channelMessageTemplates.name, update.name),
          eq(schema.channelMessageTemplates.language, update.language),
        )
      : undefined;
  if (!identity) {
    await markStale(tx, channel, now, 'missing_identity');
    return;
  }
  const [template] = await tx
    .select({ id: schema.channelMessageTemplates.id })
    .from(schema.channelMessageTemplates)
    .where(
      and(
        eq(schema.channelMessageTemplates.workspaceId, channel.workspaceId),
        eq(schema.channelMessageTemplates.channelId, channel.id),
        identity,
      ),
    )
    .limit(1);
  if (!template) {
    // O webhook não traz components/category de forma confiável: nunca inserimos
    // uma linha parcial. A sincronização manual recupera o snapshot completo.
    await markStale(tx, channel, now, 'template_not_found');
    return;
  }
  await tx
    .update(schema.channelMessageTemplates)
    .set({
      status: update.status,
      isAvailable: !update.deleted,
      lastSyncedAt: now,
      updatedAt: now,
      ...(update.rejectionReason !== undefined
        ? { rejectionReason: update.rejectionReason }
        : update.status.toUpperCase() === 'APPROVED'
          ? { rejectionReason: null }
          : {}),
    })
    .where(
      and(
        eq(schema.channelMessageTemplates.workspaceId, channel.workspaceId),
        eq(schema.channelMessageTemplates.channelId, channel.id),
        eq(schema.channelMessageTemplates.id, template.id),
      ),
    );
}

/** Aplica cada evento a todos os canais ativos da WABA, sempre sob RLS do tenant. */
export async function processMetaTemplateStatusUpdates(
  updates: readonly MetaTemplateStatusUpdate[],
  deps: TemplateStatusDeps = defaultDeps,
): Promise<void> {
  for (const update of updates) {
    const channels = await deps.resolveChannels(update.wabaId);
    for (const channel of channels) {
      await deps.mutateWorkspace(channel.workspaceId, (tx) =>
        applyOne(tx, channel, update, deps.now()),
      );
    }
  }
}
