import { describe, expect, it } from 'vitest';
import { referenceIndexSchema } from '@hm/flow-engine';
import { buildExportBundle } from './export';
import { verifyChecksum } from './checksum';
import { createFakePort } from './fake-port';
import type { RawFlowRow } from './ports';

const TAG = 'aaaaaaaa-0000-0000-0000-000000000001';

const row: RawFlowRow = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Boas-vindas',
  description: null,
  triggerType: 'manual',
  triggerConfig: {},
  filterStatus: null,
  filterStageIds: null,
  filterTagIds: null,
  channelIds: null,
  nodes: [
    { id: 't', type: 'trigger', data: {} },
    { id: 'n1', type: 'add_tag', data: { tagId: TAG } },
  ],
  edges: [],
  schemaVersion: 1,
};

describe('buildExportBundle', () => {
  it('monta envelope assinado com referências enriquecidas', async () => {
    const { port } = createFakePort({
      flows: [row],
      index: referenceIndexSchema.parse({ tags: [{ id: TAG, name: 'VIP' }] }),
    });
    const env = await buildExportBundle(port);

    expect(env.formatVersion).toBe(1);
    expect(env.app).toBe('leadium');
    expect(env.flows).toHaveLength(1);
    expect(env.flows[0]!.sourceId).toBe(row.id);
    expect(env.references.tags).toEqual([{ id: TAG, name: 'VIP' }]);
    expect(verifyChecksum(env)).toBe(true);
  });

  it('envelope vazio quando não há flows', async () => {
    const { port } = createFakePort({ flows: [] });
    const env = await buildExportBundle(port);
    expect(env.flows).toHaveLength(0);
    expect(verifyChecksum(env)).toBe(true);
  });
});
