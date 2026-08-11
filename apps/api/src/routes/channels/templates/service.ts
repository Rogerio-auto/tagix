import {
  and,
  eq,
  isNull,
  lt,
  ne,
  or,
  type SQL,
} from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import type { MetaMessageTemplate } from '@hm/channels';

const SYNC_LEASE_MS = 25 * 60 * 1_000;

export interface TemplateChannelCredentials {
  readonly channelId: string;
  readonly workspaceId: string;
  readonly wabaId: string;
  readonly accessTokenEnc: string;
  readonly keyVersion: number;
}

export type TemplateChannelLookup =
  | { readonly ok: true; readonly value: TemplateChannelCredentials }
  | { readonly ok: false; readonly reason: 'not_found' | 'wrong_provider' | 'inactive' | 'missing_credentials' };

/** Lê apenas o segredo cifrado; decifrar e chamar a Meta acontece fora da transação. */
export async function loadTemplateChannel(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
): Promise<TemplateChannelLookup> {
  const [row] = await tx
    .select({
      id: schema.channels.id,
      workspaceId: schema.channels.workspaceId,
      provider: schema.channels.provider,
      isActive: schema.channels.isActive,
      wabaId: schema.channels.wabaId,
      accessTokenEnc: schema.channelSecrets.accessTokenEnc,
      keyVersion: schema.channelSecrets.keyVersion,
    })
    .from(schema.channels)
    .leftJoin(schema.channelSecrets, eq(schema.channelSecrets.channelId, schema.channels.id))
    .where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.id, channelId)))
    .limit(1);

  if (!row) return { ok: false, reason: 'not_found' };
  if (row.provider !== 'meta_whatsapp') return { ok: false, reason: 'wrong_provider' };
  if (!row.isActive) return { ok: false, reason: 'inactive' };
  if (!row.wabaId || !row.accessTokenEnc || row.keyVersion === null) {
    return { ok: false, reason: 'missing_credentials' };
  }
  return {
    ok: true,
    value: {
      channelId: row.id,
      workspaceId: row.workspaceId,
      wabaId: row.wabaId,
      accessTokenEnc: row.accessTokenEnc,
      keyVersion: row.keyVersion,
    },
  };
}

export interface SyncClaim {
  readonly acquired: boolean;
  readonly retryAfterSeconds?: number;
}

/** Lease atômico: uma sincronização travada pode ser retomada após 25 minutos. */
export async function claimTemplateSync(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  now: Date,
): Promise<SyncClaim> {
  const inserted = await tx
    .insert(schema.channelMessageTemplateSyncStates)
    .values({
      workspaceId,
      channelId,
      syncStatus: 'running',
      lastAttemptAt: now,
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: schema.channelMessageTemplateSyncStates.channelId })
    .returning({ channelId: schema.channelMessageTemplateSyncStates.channelId });
  if (inserted.length > 0) return { acquired: true };

  const expiredBefore = new Date(now.getTime() - SYNC_LEASE_MS);
  const reclaimed = await tx
    .update(schema.channelMessageTemplateSyncStates)
    .set({ syncStatus: 'running', lastAttemptAt: now, lastError: null, updatedAt: now })
    .where(
      and(
        eq(schema.channelMessageTemplateSyncStates.workspaceId, workspaceId),
        eq(schema.channelMessageTemplateSyncStates.channelId, channelId),
        or(
          ne(schema.channelMessageTemplateSyncStates.syncStatus, 'running'),
          isNull(schema.channelMessageTemplateSyncStates.lastAttemptAt),
          lt(schema.channelMessageTemplateSyncStates.lastAttemptAt, expiredBefore),
        ),
      ),
    )
    .returning({ channelId: schema.channelMessageTemplateSyncStates.channelId });
  if (reclaimed.length > 0) return { acquired: true };

  const [current] = await tx
    .select({ lastAttemptAt: schema.channelMessageTemplateSyncStates.lastAttemptAt })
    .from(schema.channelMessageTemplateSyncStates)
    .where(
      and(
        eq(schema.channelMessageTemplateSyncStates.workspaceId, workspaceId),
        eq(schema.channelMessageTemplateSyncStates.channelId, channelId),
      ),
    )
    .limit(1);
  const leaseEndsAt = (current?.lastAttemptAt?.getTime() ?? now.getTime()) + SYNC_LEASE_MS;
  return {
    acquired: false,
    retryAfterSeconds: Math.max(1, Math.ceil((leaseEndsAt - now.getTime()) / 1_000)),
  };
}

function rawStatus(template: MetaMessageTemplate): string {
  return template.providerStatus ?? template.status;
}

function rawCategory(template: MetaMessageTemplate): string {
  return template.providerCategory ?? template.category;
}

export interface SyncSummary {
  readonly created: number;
  readonly updated: number;
  readonly archived: number;
  readonly total: number;
  readonly syncedAt: Date;
}

/** Reconcilia o snapshot completo sem depender de enums fechados do provider. */
export async function reconcileTemplates(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  templates: readonly MetaMessageTemplate[],
  now: Date,
): Promise<SyncSummary> {
  const existing = await tx
    .select()
    .from(schema.channelMessageTemplates)
    .where(
      and(
        eq(schema.channelMessageTemplates.workspaceId, workspaceId),
        eq(schema.channelMessageTemplates.channelId, channelId),
      ),
    );
  const byExternalId = new Map(existing.map((item) => [item.externalId, item]));
  const byIdentity = new Map(existing.map((item) => [`${item.name}\u0000${item.language}`, item]));
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;

  for (const template of templates) {
    const match =
      byExternalId.get(template.externalId) ??
      byIdentity.get(`${template.name}\u0000${template.language}`);
    const values = {
      externalId: template.externalId,
      name: template.name,
      language: template.language,
      category: rawCategory(template),
      status: rawStatus(template),
      components: [...template.components],
      rejectionReason: template.rejectionReason ?? null,
      isAvailable: true,
      lastSyncedAt: now,
      updatedAt: now,
    };
    if (match) {
      await tx
        .update(schema.channelMessageTemplates)
        .set(values)
        .where(
          and(
            eq(schema.channelMessageTemplates.workspaceId, workspaceId),
            eq(schema.channelMessageTemplates.id, match.id),
          ),
        );
      seen.add(match.id);
      updated += 1;
    } else {
      const [inserted] = await tx
        .insert(schema.channelMessageTemplates)
        .values({ workspaceId, channelId, ...values })
        .returning({ id: schema.channelMessageTemplates.id });
      if (inserted) seen.add(inserted.id);
      created += 1;
    }
  }

  const toArchive = existing.filter((item) => !seen.has(item.id) && item.isAvailable);
  for (const item of toArchive) {
    await tx
      .update(schema.channelMessageTemplates)
      .set({ isAvailable: false, lastSyncedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.channelMessageTemplates.workspaceId, workspaceId),
          eq(schema.channelMessageTemplates.id, item.id),
        ),
      );
  }

  await tx
    .update(schema.channelMessageTemplateSyncStates)
    .set({
      syncStatus: 'succeeded',
      lastSuccessfulSyncAt: now,
      lastError: null,
      lastItemCount: templates.length,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.channelMessageTemplateSyncStates.workspaceId, workspaceId),
        eq(schema.channelMessageTemplateSyncStates.channelId, channelId),
      ),
    );

  return {
    created,
    updated,
    archived: toArchive.length,
    total: templates.length,
    syncedAt: now,
  };
}

export async function markTemplateSyncFailed(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  now: Date,
  safeError: string,
): Promise<void> {
  await tx
    .update(schema.channelMessageTemplateSyncStates)
    .set({ syncStatus: 'failed', lastFailedAt: now, lastError: safeError, updatedAt: now })
    .where(
      and(
        eq(schema.channelMessageTemplateSyncStates.workspaceId, workspaceId),
        eq(schema.channelMessageTemplateSyncStates.channelId, channelId),
      ),
    );
}

/** Upsert pontual após criação; não arquiva os demais itens do catálogo. */
export async function persistCreatedTemplate(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  template: MetaMessageTemplate,
  now: Date,
) {
  const identity: SQL<unknown> = or(
    eq(schema.channelMessageTemplates.externalId, template.externalId),
    and(
      eq(schema.channelMessageTemplates.name, template.name),
      eq(schema.channelMessageTemplates.language, template.language),
    ),
  )!;
  const [existing] = await tx
    .select({ id: schema.channelMessageTemplates.id })
    .from(schema.channelMessageTemplates)
    .where(
      and(
        eq(schema.channelMessageTemplates.workspaceId, workspaceId),
        eq(schema.channelMessageTemplates.channelId, channelId),
        identity,
      ),
    )
    .limit(1);
  const values = {
    externalId: template.externalId,
    name: template.name,
    language: template.language,
    category: rawCategory(template),
    status: rawStatus(template),
    components: [...template.components],
    rejectionReason: template.rejectionReason ?? null,
    isAvailable: true,
    lastSyncedAt: now,
    updatedAt: now,
  };
  if (existing) {
    const [row] = await tx
      .update(schema.channelMessageTemplates)
      .set(values)
      .where(
        and(
          eq(schema.channelMessageTemplates.workspaceId, workspaceId),
          eq(schema.channelMessageTemplates.id, existing.id),
        ),
      )
      .returning();
    return row;
  }
  const [row] = await tx
    .insert(schema.channelMessageTemplates)
    .values({ workspaceId, channelId, ...values })
    .returning();
  return row;
}
