import { describe, expect, it } from 'vitest';
import { extractReferences, rewriteReferences, refKey, type RefIdMap } from './references';
import type { FlowBackupEntry } from './envelope';

/** Entry mínima; cada teste injeta nodes/config conforme o caso. */
function entry(over: Partial<FlowBackupEntry> = {}): FlowBackupEntry {
  return {
    sourceId: '11111111-1111-1111-1111-111111111111',
    name: 'F',
    triggerType: 'manual',
    triggerConfig: {},
    nodes: [],
    edges: [],
    schemaVersion: 1,
    ...over,
  } as FlowBackupEntry;
}

const node = (id: string, type: string, data: unknown) => ({ id, type, data });

describe('extractReferences', () => {
  it('extrai UUIDs de todos os tipos de nó com referência', () => {
    const e = entry({
      nodes: [
        node('n1', 'condition', { operator: 'HAS_TAG', tagId: 'tag-1' }),
        node('n2', 'condition', { operator: 'IN_STAGE', stageId: 'stage-1' }),
        node('n3', 'move_stage', { stageId: 'stage-2', pipelineId: 'pipe-1' }),
        node('n4', 'add_tag', { tagId: 'tag-2' }),
        node('n5', 'remove_tag', { tagId: 'tag-3' }),
        node('n6', 'ai_action', { action: 'ACTIVATE', agentId: 'agent-1' }),
        node('n7', 'assign', { strategy: 'specific', memberId: 'member-1' }),
        node('n8', 'go_to_flow', { flowId: 'flow-9' }),
        node('n9', 'external_notify', { target: 'CUSTOM', channelId: 'chan-1' }),
      ],
    });
    const refs = extractReferences(e);
    expect(refs).toEqual(
      expect.arrayContaining([
        { kind: 'tag', value: 'tag-1', nodeId: 'n1', path: 'node.data.tagId' },
        { kind: 'stage', value: 'stage-1', nodeId: 'n2', path: 'node.data.stageId' },
        { kind: 'stage', value: 'stage-2', nodeId: 'n3', path: 'node.data.stageId' },
        { kind: 'pipeline', value: 'pipe-1', nodeId: 'n3', path: 'node.data.pipelineId' },
        { kind: 'tag', value: 'tag-2', nodeId: 'n4', path: 'node.data.tagId' },
        { kind: 'tag', value: 'tag-3', nodeId: 'n5', path: 'node.data.tagId' },
        { kind: 'agent', value: 'agent-1', nodeId: 'n6', path: 'node.data.agentId' },
        { kind: 'member', value: 'member-1', nodeId: 'n7', path: 'node.data.memberId' },
        { kind: 'flow', value: 'flow-9', nodeId: 'n8', path: 'node.data.flowId' },
        { kind: 'channel', value: 'chan-1', nodeId: 'n9', path: 'node.data.channelId' },
      ]),
    );
  });

  it('extrai refs de filtros do flow e do triggerConfig', () => {
    const e = entry({
      triggerType: 'stage_change',
      triggerConfig: { from_stage_id: 's-from', to_stage_id: 's-to' },
      filterStageIds: ['fs-1'],
      filterTagIds: ['ft-1', 'ft-2'],
      channelIds: ['c-1'],
    });
    const refs = extractReferences(e);
    expect(refs).toEqual(
      expect.arrayContaining([
        { kind: 'stage', value: 'fs-1', path: 'filterStageIds[0]' },
        { kind: 'tag', value: 'ft-1', path: 'filterTagIds[0]' },
        { kind: 'tag', value: 'ft-2', path: 'filterTagIds[1]' },
        { kind: 'channel', value: 'c-1', path: 'channelIds[0]' },
        { kind: 'stage', value: 's-from', path: 'triggerConfig.from_stage_id' },
        { kind: 'stage', value: 's-to', path: 'triggerConfig.to_stage_id' },
      ]),
    );
  });

  it('triggerConfig tag_added e tag_id só conta no trigger certo', () => {
    const added = extractReferences(
      entry({ triggerType: 'tag_added', triggerConfig: { tag_id: 't-x' } }),
    );
    expect(added).toContainEqual({ kind: 'tag', value: 't-x', path: 'triggerConfig.tag_id' });
    // mesmo config sob trigger manual NÃO conta como referência de trigger
    const manual = extractReferences(entry({ triggerType: 'manual', triggerConfig: { tag_id: 't-x' } }));
    expect(manual).toHaveLength(0);
  });

  it('conversionType (key) e media entram como ocorrências (report-only)', () => {
    const e = entry({
      nodes: [
        node('n1', 'register_conversion', { conversionTypeKey: 'venda' }),
        node('n2', 'message', { mediaStorageKey: 'ws/abc.ogg', text: 'oi' }),
      ],
    });
    const refs = extractReferences(e);
    expect(refs).toContainEqual({
      kind: 'conversionType',
      value: 'venda',
      nodeId: 'n1',
      path: 'node.data.conversionTypeKey',
    });
    expect(refs).toContainEqual({
      kind: 'media',
      value: 'ws/abc.ogg',
      nodeId: 'n2',
      path: 'node.data.mediaStorageKey',
    });
  });

  it('register_conversion via alias conversionType também conta', () => {
    const refs = extractReferences(
      entry({ nodes: [node('n1', 'register_conversion', { conversionType: 'visita' })] }),
    );
    expect(refs).toContainEqual({
      kind: 'conversionType',
      value: 'visita',
      nodeId: 'n1',
      path: 'node.data.conversionTypeKey',
    });
  });
});

describe('rewriteReferences', () => {
  const map = (entries: [string, string | null][]): RefIdMap => new Map(entries);

  it('remapeia UUID resolvido e limpa o não resolvido', () => {
    const e = entry({
      nodes: [
        node('n1', 'add_tag', { tagId: 'old-tag' }),
        node('n2', 'ai_action', { action: 'ACTIVATE', agentId: 'old-agent' }),
      ],
    });
    const out = rewriteReferences(
      e,
      map([
        [refKey('tag', 'old-tag'), 'new-tag'],
        [refKey('agent', 'old-agent'), null],
      ]),
    );
    expect((out.nodes[0]!.data as Record<string, unknown>)['tagId']).toBe('new-tag');
    // não resolvido → campo removido (no-op seguro)
    expect('agentId' in (out.nodes[1]!.data as Record<string, unknown>)).toBe(false);
  });

  it('mantém valor ausente do idMap (não toca conversionType/media)', () => {
    const e = entry({
      nodes: [
        node('n1', 'register_conversion', { conversionTypeKey: 'venda' }),
        node('n2', 'message', { mediaStorageKey: 'ws/x.ogg' }),
      ],
    });
    const out = rewriteReferences(e, map([]));
    expect((out.nodes[0]!.data as Record<string, unknown>)['conversionTypeKey']).toBe('venda');
    expect((out.nodes[1]!.data as Record<string, unknown>)['mediaStorageKey']).toBe('ws/x.ogg');
  });

  it('arrays: remapeia resolvidos e descarta não resolvidos', () => {
    const e = entry({ filterTagIds: ['a', 'b', 'c'] });
    const out = rewriteReferences(
      e,
      map([
        [refKey('tag', 'a'), 'A'],
        [refKey('tag', 'b'), null],
      ]),
    );
    expect(out.filterTagIds).toEqual(['A', 'c']); // b limpo, c mantido (ausente do map)
  });

  it('triggerConfig: remapeia e limpa por chave', () => {
    const e = entry({
      triggerType: 'stage_change',
      triggerConfig: { from_stage_id: 'f', to_stage_id: 't' },
    });
    const out = rewriteReferences(
      e,
      map([
        [refKey('stage', 'f'), 'F'],
        [refKey('stage', 't'), null],
      ]),
    );
    expect(out.triggerConfig['from_stage_id']).toBe('F');
    expect('to_stage_id' in out.triggerConfig).toBe(false);
  });

  it('não muta a entrada original', () => {
    const e = entry({ nodes: [node('n1', 'add_tag', { tagId: 'old' })] });
    rewriteReferences(e, map([[refKey('tag', 'old'), 'new']]));
    expect((e.nodes[0]!.data as Record<string, unknown>)['tagId']).toBe('old');
  });
});
