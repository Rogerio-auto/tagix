import { describe, expect, it, vi } from 'vitest';
import type { DbTx } from '@hm/db';
import {
  parseMetaTemplateStatusUpdates,
  processMetaTemplateStatusUpdates,
} from './meta-template-status';

function envelope(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ field: 'message_template_status_update', value }] }],
  };
}

describe('parseMetaTemplateStatusUpdates', () => {
  it('preserva status desconhecido e extrai a identidade da Meta', () => {
    expect(
      parseMetaTemplateStatusUpdates(
        envelope({
          event: 'NEW_PROVIDER_STATUS',
          message_template_id: 'meta-1',
          message_template_name: 'boas_vindas',
          message_template_language: 'pt_BR',
          reason: 'safe reason',
        }),
      ),
    ).toEqual([
      {
        wabaId: 'waba-1',
        externalId: 'meta-1',
        name: 'boas_vindas',
        language: 'pt_BR',
        status: 'NEW_PROVIDER_STATUS',
        rejectionReason: 'safe reason',
        deleted: false,
      },
    ]);
  });

  it('DELETED torna o item indisponível e payload incompleto pede reconciliação', () => {
    expect(
      parseMetaTemplateStatusUpdates(envelope({ event: 'DELETED', message_template_id: 'meta-1' }))[0]
        ?.deleted,
    ).toBe(true);
    expect(parseMetaTemplateStatusUpdates(envelope({ event: 'APPROVED' }))[0]?.staleReason).toBe(
      'missing_identity',
    );
  });
});

describe('processMetaTemplateStatusUpdates', () => {
  it('atualiza todos os canais da WABA sob o RLS de cada workspace', async () => {
    const workspaces: string[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const fakeTx = (): DbTx => {
      const selectChain = {
        from: () => selectChain,
        where: () => selectChain,
        limit: async () => [{ id: 'local-template' }],
      };
      const updateChain = {
        set: (value: Record<string, unknown>) => {
          updates.push(value);
          return updateChain;
        },
        where: async () => [],
      };
      return { select: () => selectChain, update: () => updateChain } as unknown as DbTx;
    };
    await processMetaTemplateStatusUpdates(
      parseMetaTemplateStatusUpdates(
        envelope({ event: 'DELETED', message_template_id: 'meta-1' }),
      ),
      {
        resolveChannels: async () => [
          { id: 'channel-a', workspaceId: 'workspace-a' },
          { id: 'channel-b', workspaceId: 'workspace-b' },
        ],
        mutateWorkspace: async (workspaceId, fn) => {
          workspaces.push(workspaceId);
          return fn(fakeTx());
        },
        now: () => new Date('2026-08-11T12:00:00.000Z'),
      },
    );
    expect(workspaces).toEqual(['workspace-a', 'workspace-b']);
    expect(updates).toHaveLength(2);
    expect(updates.every((value) => value['status'] === 'DELETED' && value['isAvailable'] === false)).toBe(true);
  });

  it('não insere modelo incompleto: marca o catálogo stale', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const insertChain = {
      values: (value: Record<string, unknown>) => {
        inserted.push(value);
        return insertChain;
      },
      onConflictDoUpdate: async () => [],
    };
    const tx = { insert: () => insertChain } as unknown as DbTx;
    await processMetaTemplateStatusUpdates(
      parseMetaTemplateStatusUpdates(envelope({ event: 'APPROVED' })),
      {
        resolveChannels: async () => [{ id: 'channel-a', workspaceId: 'workspace-a' }],
        mutateWorkspace: async (_workspaceId, fn) => fn(tx),
        now: () => new Date('2026-08-11T12:00:00.000Z'),
      },
    );
    expect(inserted).toEqual([
      expect.objectContaining({ channelId: 'channel-a', syncStatus: 'stale', lastError: 'missing_identity' }),
    ]);
  });

  it('propaga falha de mutação para o endpoint pedir reentrega', async () => {
    await expect(
      processMetaTemplateStatusUpdates(
        parseMetaTemplateStatusUpdates(
          envelope({ event: 'APPROVED', message_template_id: 'meta-1' }),
        ),
        {
          resolveChannels: async () => [{ id: 'channel-a', workspaceId: 'workspace-a' }],
          mutateWorkspace: vi.fn().mockRejectedValue(new Error('db down')),
          now: () => new Date(),
        },
      ),
    ).rejects.toThrow('db down');
  });
});
