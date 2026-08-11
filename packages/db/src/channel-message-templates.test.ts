import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { withWorkspace } from './rls';
import {
  channelMessageTemplates,
  channelMessageTemplateSyncStates,
  channels,
  workspaces,
} from './schema';

let wsA = '';
let wsB = '';
let channelA = '';
let channelB = '';

beforeAll(async () => {
  const db = getDb();
  const suffix = randomUUID().slice(0, 8);

  const [a] = await db
    .insert(workspaces)
    .values({ name: `Templates A ${suffix}`, slug: `templates-a-${suffix}` })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: `Templates B ${suffix}`, slug: `templates-b-${suffix}` })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces do catálogo.');
  wsA = a.id;
  wsB = b.id;

  const [aChannel] = await db
    .insert(channels)
    .values({
      workspaceId: wsA,
      provider: 'meta_whatsapp',
      name: `WhatsApp A ${suffix}`,
      phoneNumberId: `template-phone-a-${suffix}`,
      wabaId: `template-waba-a-${suffix}`,
    })
    .returning();
  const [bChannel] = await db
    .insert(channels)
    .values({
      workspaceId: wsB,
      provider: 'meta_whatsapp',
      name: `WhatsApp B ${suffix}`,
      phoneNumberId: `template-phone-b-${suffix}`,
      wabaId: `template-waba-b-${suffix}`,
    })
    .returning();
  if (!aChannel || !bChannel) throw new Error('Falha ao criar canais do catálogo.');
  channelA = aChannel.id;
  channelB = bChannel.id;
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('catálogo de modelos de mensagem do WhatsApp', () => {
  it('preserva status/categoria desconhecidos e componentes como unknown[]', async () => {
    const db = getDb();
    const suffix = randomUUID().slice(0, 8);
    const components: unknown[] = [
      { type: 'BODY', text: 'Olá, {{1}}' },
      { type: 'FUTURE_COMPONENT', payload: { nested: true } },
    ];

    const [created] = await db
      .insert(channelMessageTemplates)
      .values({
        workspaceId: wsA,
        channelId: channelA,
        externalId: `external-flex-${suffix}`,
        name: `modelo_flex_${suffix}`,
        language: 'pt_BR',
        category: 'FUTURE_CATEGORY',
        status: 'FUTURE_STATUS',
        components,
      })
      .returning();

    expect(created?.category).toBe('FUTURE_CATEGORY');
    expect(created?.status).toBe('FUTURE_STATUS');
    expect(created?.components).toEqual(components);
    expect(created?.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('isola catálogo e estado de sincronização entre workspaces via RLS', async () => {
    const db = getDb();
    const suffix = randomUUID().slice(0, 8);
    const [templateA] = await db
      .insert(channelMessageTemplates)
      .values({
        workspaceId: wsA,
        channelId: channelA,
        externalId: `external-rls-a-${suffix}`,
        name: `modelo_rls_a_${suffix}`,
        language: 'pt_BR',
        category: 'MARKETING',
        status: 'APPROVED',
      })
      .returning();
    if (!templateA) throw new Error('Falha ao criar modelo do workspace A.');

    await db
      .insert(channelMessageTemplateSyncStates)
      .values({ workspaceId: wsA, channelId: channelA, syncStatus: 'succeeded' })
      .onConflictDoUpdate({
        target: channelMessageTemplateSyncStates.channelId,
        set: { syncStatus: 'succeeded' },
      });

    const catalogA = await withWorkspace(wsA, (tx) => tx.select().from(channelMessageTemplates));
    expect(catalogA.some((item) => item.id === templateA.id)).toBe(true);
    expect(catalogA.every((item) => item.workspaceId === wsA)).toBe(true);

    const catalogB = await withWorkspace(wsB, (tx) => tx.select().from(channelMessageTemplates));
    expect(catalogB.some((item) => item.id === templateA.id)).toBe(false);

    const syncA = await withWorkspace(wsA, (tx) =>
      tx.select().from(channelMessageTemplateSyncStates),
    );
    const syncB = await withWorkspace(wsB, (tx) =>
      tx.select().from(channelMessageTemplateSyncStates),
    );
    expect(syncA.some((state) => state.channelId === channelA)).toBe(true);
    expect(syncB.some((state) => state.channelId === channelA)).toBe(false);

    await expect(
      withWorkspace(wsA, (tx) =>
        tx.insert(channelMessageTemplates).values({
          workspaceId: wsB,
          channelId: channelB,
          externalId: `external-cross-rls-${suffix}`,
          name: `modelo_cross_rls_${suffix}`,
          language: 'pt_BR',
          category: 'UTILITY',
          status: 'APPROVED',
        }),
      ),
    ).rejects.toThrow();
  });

  it('FK composta rejeita workspace de um tenant com canal de outro', async () => {
    const db = getDb();
    const suffix = randomUUID().slice(0, 8);
    await expect(
      db.insert(channelMessageTemplates).values({
        workspaceId: wsA,
        channelId: channelB,
        externalId: `external-cross-channel-${suffix}`,
        name: `modelo_cross_channel_${suffix}`,
        language: 'pt_BR',
        category: 'UTILITY',
        status: 'APPROVED',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(channelMessageTemplateSyncStates).values({
        workspaceId: wsA,
        channelId: channelB,
        syncStatus: 'running',
      }),
    ).rejects.toThrow();
  });

  it('garante unicidade de nome+idioma e id externo dentro do canal', async () => {
    const db = getDb();
    const suffix = randomUUID().slice(0, 8);
    const base = {
      workspaceId: wsA,
      channelId: channelA,
      externalId: `external-unique-${suffix}`,
      name: `modelo_unique_${suffix}`,
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
    };
    await db.insert(channelMessageTemplates).values(base);

    await expect(
      db.insert(channelMessageTemplates).values({
        ...base,
        externalId: `external-other-${suffix}`,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(channelMessageTemplates).values({
        ...base,
        name: `modelo_other_${suffix}`,
      }),
    ).rejects.toThrow();

    // O mesmo nome pode existir em outro idioma.
    await expect(
      db.insert(channelMessageTemplates).values({
        ...base,
        externalId: `external-language-${suffix}`,
        language: 'en_US',
      }),
    ).resolves.toBeDefined();
  });

  it('CHECK do banco rejeita components que não sejam array JSON', async () => {
    const db = getDb();
    const suffix = randomUUID().slice(0, 8);
    await expect(
      db.execute(sql`
        INSERT INTO channel_message_templates (
          workspace_id, channel_id, external_id, name, language, category, status, components
        ) VALUES (
          ${wsA}, ${channelA}, ${`external-json-${suffix}`}, ${`modelo_json_${suffix}`},
          'pt_BR', 'UTILITY', 'APPROVED', ${'{}'}::jsonb
        )
      `),
    ).rejects.toThrow();
  });

  it('sucesso vazio é preservado quando uma tentativa posterior falha', async () => {
    const db = getDb();
    const successfulAt = new Date('2026-08-10T12:00:00.000Z');
    const failedAt = new Date('2026-08-10T12:05:00.000Z');

    await db
      .insert(channelMessageTemplateSyncStates)
      .values({
        workspaceId: wsA,
        channelId: channelA,
        syncStatus: 'succeeded',
        lastAttemptAt: successfulAt,
        lastSuccessfulSyncAt: successfulAt,
        lastItemCount: 0,
      })
      .onConflictDoUpdate({
        target: channelMessageTemplateSyncStates.channelId,
        set: {
          syncStatus: 'succeeded',
          lastAttemptAt: successfulAt,
          lastSuccessfulSyncAt: successfulAt,
          lastFailedAt: null,
          lastError: null,
          lastItemCount: 0,
        },
      });

    await db
      .update(channelMessageTemplateSyncStates)
      .set({
        syncStatus: 'failed',
        lastAttemptAt: failedAt,
        lastFailedAt: failedAt,
        lastError: 'Meta temporariamente indisponível',
      })
      .where(eq(channelMessageTemplateSyncStates.channelId, channelA));

    const [state] = await db
      .select()
      .from(channelMessageTemplateSyncStates)
      .where(eq(channelMessageTemplateSyncStates.channelId, channelA));
    expect(state?.syncStatus).toBe('failed');
    expect(state?.lastSuccessfulSyncAt?.toISOString()).toBe(successfulAt.toISOString());
    expect(state?.lastItemCount).toBe(0);
    expect(state?.lastFailedAt?.toISOString()).toBe(failedAt.toISOString());
    expect(state?.lastError).toBe('Meta temporariamente indisponível');
  });

  it('deletar o canal remove catálogo e estado de sincronização em cascata', async () => {
    const db = getDb();
    const suffix = randomUUID().slice(0, 8);
    const [channel] = await db
      .insert(channels)
      .values({
        workspaceId: wsA,
        provider: 'meta_whatsapp',
        name: `WhatsApp cascade ${suffix}`,
        phoneNumberId: `template-cascade-phone-${suffix}`,
        wabaId: `template-cascade-waba-${suffix}`,
      })
      .returning();
    if (!channel) throw new Error('Falha ao criar canal para teste de cascade.');

    const [template] = await db
      .insert(channelMessageTemplates)
      .values({
        workspaceId: wsA,
        channelId: channel.id,
        externalId: `external-cascade-${suffix}`,
        name: `modelo_cascade_${suffix}`,
        language: 'pt_BR',
        category: 'UTILITY',
        status: 'APPROVED',
      })
      .returning();
    await db.insert(channelMessageTemplateSyncStates).values({
      workspaceId: wsA,
      channelId: channel.id,
      syncStatus: 'succeeded',
    });
    if (!template) throw new Error('Falha ao criar modelo para teste de cascade.');

    await db.delete(channels).where(eq(channels.id, channel.id));

    const remainingTemplates = await db
      .select()
      .from(channelMessageTemplates)
      .where(eq(channelMessageTemplates.id, template.id));
    const remainingSyncStates = await db
      .select()
      .from(channelMessageTemplateSyncStates)
      .where(
        and(
          eq(channelMessageTemplateSyncStates.workspaceId, wsA),
          eq(channelMessageTemplateSyncStates.channelId, channel.id),
        ),
      );
    expect(remainingTemplates).toEqual([]);
    expect(remainingSyncStates).toEqual([]);
  });

  it('RLS está habilitada e forçada nas duas tabelas', async () => {
    const db = getDb();
    const rows = await db.execute<{ relname: string; enabled: boolean; forced: boolean }>(sql`
      SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'channel_message_templates',
          'channel_message_template_sync_states'
        )
      ORDER BY c.relname
    `);
    expect(Array.from(rows)).toEqual([
      {
        relname: 'channel_message_template_sync_states',
        enabled: true,
        forced: true,
      },
      { relname: 'channel_message_templates', enabled: true, forced: true },
    ]);
  });
});
