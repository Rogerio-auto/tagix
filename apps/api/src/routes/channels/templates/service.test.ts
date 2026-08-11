import { describe, expect, it } from 'vitest';
import type { DbTx } from '@hm/db';
import type { MetaMessageTemplate } from '@hm/channels';
import {
  claimTemplateSync,
  markTemplateSyncFailed,
  reconcileTemplates,
} from './service';

function claimTx(input: {
  inserted?: boolean;
  reclaimed?: boolean;
  lastAttemptAt?: Date;
}): DbTx {
  const insertChain = {
    values: () => insertChain,
    onConflictDoNothing: () => insertChain,
    returning: async () => (input.inserted ? [{ channelId: 'channel-a' }] : []),
  };
  const updateChain = {
    set: () => updateChain,
    where: () => updateChain,
    returning: async () => (input.reclaimed ? [{ channelId: 'channel-a' }] : []),
  };
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => [{ lastAttemptAt: input.lastAttemptAt ?? new Date() }],
  };
  return {
    insert: () => insertChain,
    update: () => updateChain,
    select: () => selectChain,
  } as unknown as DbTx;
}

describe('claimTemplateSync', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');

  it('adquire um cursor novo e retoma lease expirada', async () => {
    await expect(claimTemplateSync(claimTx({ inserted: true }), 'workspace-a', 'channel-a', now)).resolves.toEqual({
      acquired: true,
    });
    await expect(claimTemplateSync(claimTx({ reclaimed: true }), 'workspace-a', 'channel-a', now)).resolves.toEqual({
      acquired: true,
    });
  });

  it('rejeita sincronização concorrente com Retry-After calculado', async () => {
    const result = await claimTemplateSync(
      claimTx({ lastAttemptAt: new Date('2026-08-11T11:55:00.000Z') }),
      'workspace-a',
      'channel-a',
      now,
    );
    expect(result.acquired).toBe(false);
    expect(result.retryAfterSeconds).toBe(20 * 60);
  });
});

interface ExistingTemplate {
  id: string;
  externalId: string;
  name: string;
  language: string;
  isAvailable: boolean;
}

function reconciliationTx(existing: readonly ExistingTemplate[]) {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const selectChain = {
    from: () => selectChain,
    where: async () => existing,
  };
  const insertChain = {
    values: (value: Record<string, unknown>) => {
      inserted.push(value);
      return insertChain;
    },
    returning: async () => [{ id: `new-${nextId++}` }],
  };
  const updateChain = {
    set: (value: Record<string, unknown>) => {
      updated.push(value);
      return updateChain;
    },
    where: async () => [],
  };
  return {
    tx: {
      select: () => selectChain,
      insert: () => insertChain,
      update: () => updateChain,
    } as unknown as DbTx,
    inserted,
    updated,
  };
}

describe('reconcileTemplates', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const remote: MetaMessageTemplate[] = [
    {
      externalId: 'meta-1',
      name: 'reativado',
      language: 'pt_BR',
      category: 'UNKNOWN',
      providerCategory: 'FUTURE_CATEGORY',
      status: 'UNKNOWN',
      providerStatus: 'FUTURE_STATUS',
      components: [{ type: 'BODY', text: 'Olá' }],
    },
    {
      externalId: 'meta-2',
      name: 'novo',
      language: 'en_US',
      category: 'UTILITY',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Hello' }],
    },
  ];

  it('faz upsert idempotente, reativa presentes, preserva raw e arquiva ausentes', async () => {
    const state = reconciliationTx([
      { id: 'local-1', externalId: 'meta-1', name: 'reativado', language: 'pt_BR', isAvailable: false },
      { id: 'local-old', externalId: 'meta-old', name: 'antigo', language: 'pt_BR', isAvailable: true },
    ]);
    const summary = await reconcileTemplates(state.tx, 'workspace-a', 'channel-a', remote, now);
    expect(summary).toEqual({ created: 1, updated: 1, archived: 1, total: 2, syncedAt: now });
    expect(state.updated).toContainEqual(
      expect.objectContaining({
        externalId: 'meta-1',
        status: 'FUTURE_STATUS',
        category: 'FUTURE_CATEGORY',
        isAvailable: true,
      }),
    );
    expect(state.updated).toContainEqual(expect.objectContaining({ isAvailable: false }));
    expect(state.updated).toContainEqual(
      expect.objectContaining({ syncStatus: 'succeeded', lastSuccessfulSyncAt: now, lastItemCount: 2 }),
    );
  });

  it('lista vazia é sucesso válido e arquiva o que sumiu', async () => {
    const state = reconciliationTx([
      { id: 'local-old', externalId: 'meta-old', name: 'antigo', language: 'pt_BR', isAvailable: true },
    ]);
    const summary = await reconcileTemplates(state.tx, 'workspace-a', 'channel-a', [], now);
    expect(summary).toEqual({ created: 0, updated: 0, archived: 1, total: 0, syncedAt: now });
    expect(state.updated).toContainEqual(
      expect.objectContaining({ syncStatus: 'succeeded', lastSuccessfulSyncAt: now, lastItemCount: 0 }),
    );
  });

  it('falha atualiza só a tentativa e preserva o último sucesso', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const updateChain = {
      set: (value: Record<string, unknown>) => {
        updates.push(value);
        return updateChain;
      },
      where: async () => [],
    };
    await markTemplateSyncFailed(
      { update: () => updateChain } as unknown as DbTx,
      'workspace-a',
      'channel-a',
      now,
      'network',
    );
    expect(updates[0]).toEqual(
      expect.objectContaining({ syncStatus: 'failed', lastFailedAt: now, lastError: 'network' }),
    );
    expect(updates[0]).not.toHaveProperty('lastSuccessfulSyncAt');
  });
});
