import { describe, expect, it } from 'vitest';
import {
  flowBackupEntrySchema,
  referenceIndexSchema,
  type BackupEnvelope,
  type FlowBackupEntry,
  type ReferenceIndex,
} from '@hm/flow-engine';
import { computeChecksum } from './checksum';
import { applyImport, previewImport } from './import';
import { createFakePort, emptyLookups } from './fake-port';

const FLOW_A = '11111111-1111-1111-1111-111111111111';
const FLOW_B = '22222222-2222-2222-2222-222222222222';
const TAG_OLD = 'aaaaaaaa-0000-0000-0000-000000000001';
const AGENT_OLD = 'bbbbbbbb-0000-0000-0000-000000000001';

const node = (id: string, type: string, data: unknown) => ({ id, type, data });

function envelope(flows: FlowBackupEntry[], references: Partial<ReferenceIndex> = {}): BackupEnvelope {
  const refs = referenceIndexSchema.parse(references);
  const parsed = flows.map((f) => flowBackupEntrySchema.parse(f));
  return {
    formatVersion: 1,
    app: 'leadium',
    exportedAt: '2026-06-26T00:00:00.000Z',
    schemaVersion: 1,
    checksum: computeChecksum({ flows: parsed, references: refs }),
    flows: parsed,
    references: refs,
  };
}

describe('previewImport', () => {
  it('reporta refs resolvidas vs não-resolvidas + checksum válido', async () => {
    const env = envelope(
      [
        {
          sourceId: FLOW_A,
          name: 'Boas-vindas',
          triggerType: 'manual',
          triggerConfig: {},
          nodes: [
            node('t', 'trigger', {}),
            node('n1', 'add_tag', { tagId: TAG_OLD }),
            node('n2', 'ai_action', { action: 'ACTIVATE', agentId: AGENT_OLD }),
          ],
          edges: [],
          schemaVersion: 1,
        },
      ],
      { tags: [{ id: TAG_OLD, name: 'VIP' }], agents: [{ id: AGENT_OLD, name: 'Bot' }] },
    );
    const { port } = createFakePort({
      lookups: { tagIdByName: new Map([['VIP', 'tag-new']]) }, // agente NÃO resolve
    });
    const r = await previewImport(port, env);
    expect(r.checksumValid).toBe(true);
    expect(r.flowCount).toBe(1);
    const f = r.flows[0]!;
    expect(f.resolvedReferences).toBe(1);
    expect(f.unresolvedReferences).toHaveLength(1);
    expect(f.unresolvedReferences[0]).toMatchObject({ kind: 'agent', label: 'Bot', resolvedId: null });
    expect(f.nameCollision).toBe(false);
  });

  it('flag de colisão de nome e mídia', async () => {
    const env = envelope([
      {
        sourceId: FLOW_A,
        name: 'Existe',
        triggerType: 'manual',
        triggerConfig: {},
        nodes: [node('t', 'trigger', {}), node('m', 'message', { mediaStorageKey: 'ws/a.ogg' })],
        edges: [],
        schemaVersion: 1,
      },
    ]);
    const { port } = createFakePort({ existingNames: ['Existe'] });
    const r = await previewImport(port, env);
    expect(r.flows[0]!.nameCollision).toBe(true);
    expect(r.flows[0]!.finalName).toBe('Existe (importado)');
    expect(r.flows[0]!.mediaWarnings).toBe(1);
  });
});

describe('applyImport', () => {
  it('cria rascunhos, remapeia tag resolvida e limpa a não resolvida', async () => {
    const env = envelope(
      [
        {
          sourceId: FLOW_A,
          name: 'F',
          triggerType: 'manual',
          triggerConfig: {},
          nodes: [
            node('n1', 'add_tag', { tagId: TAG_OLD }),
            node('n2', 'ai_action', { action: 'ACTIVATE', agentId: AGENT_OLD }),
          ],
          edges: [],
          schemaVersion: 1,
        },
      ],
      { tags: [{ id: TAG_OLD, name: 'VIP' }], agents: [{ id: AGENT_OLD, name: 'Bot' }] },
    );
    const { port, inserted } = createFakePort({
      lookups: { tagIdByName: new Map([['VIP', 'tag-new']]) },
    });
    const r = await applyImport(port, env);

    expect(inserted).toHaveLength(1);
    const n = inserted[0]!.nodes as { type: string; data: Record<string, unknown> }[];
    expect(n[0]!.data['tagId']).toBe('tag-new'); // resolvido
    expect('agentId' in n[1]!.data).toBe(false); // não resolvido → limpo
    expect(r.created[0]).toMatchObject({ sourceId: FLOW_A, finalName: 'F' });
    expect(r.unresolvedReferencesCleared).toBeGreaterThanOrEqual(1);
  });

  it('sufixa o nome em colisão (sem sobrescrever)', async () => {
    const env = envelope([
      {
        sourceId: FLOW_A,
        name: 'Promo',
        triggerType: 'manual',
        triggerConfig: {},
        nodes: [node('t', 'trigger', {})],
        edges: [],
        schemaVersion: 1,
      },
    ]);
    const { inserted, port } = createFakePort({ existingNames: ['Promo'] });
    await applyImport(port, env);
    expect(inserted[0]!.name).toBe('Promo (importado)');
  });

  it('remapeia go_to_flow intra-bundle (sourceId → novo id)', async () => {
    const env = envelope(
      [
        {
          sourceId: FLOW_A,
          name: 'A',
          triggerType: 'manual',
          triggerConfig: {},
          nodes: [node('t', 'trigger', {})],
          edges: [],
          schemaVersion: 1,
        },
        {
          sourceId: FLOW_B,
          name: 'B',
          triggerType: 'manual',
          triggerConfig: {},
          nodes: [node('g', 'go_to_flow', { flowId: FLOW_A })],
          edges: [],
          schemaVersion: 1,
        },
      ],
      { flows: [{ id: FLOW_A, name: 'A' }] },
    );
    const { inserted, port } = createFakePort();
    await applyImport(port, env);

    const rowA = inserted.find((r) => r.name === 'A')!;
    const rowB = inserted.find((r) => r.name === 'B')!;
    const gNode = (rowB.nodes as { type: string; data: Record<string, unknown> }[])[0]!;
    expect(gNode.data['flowId']).toBe(rowA.id); // aponta para o NOVO id do flow A importado
    expect(rowA.id).not.toBe(FLOW_A); // id novo, não o do arquivo
  });

  it('força status draft via port (workspaceId/createdBy ficam no db-port real)', async () => {
    // O fake não seta workspaceId/status (isso é do db-port real); aqui garantimos só que
    // applyImport delega a inserção e devolve os criados.
    const env = envelope([
      {
        sourceId: FLOW_A,
        name: 'X',
        triggerType: 'manual',
        triggerConfig: {},
        nodes: [node('t', 'trigger', {})],
        edges: [],
        schemaVersion: 1,
      },
    ]);
    const { inserted, port } = createFakePort();
    const r = await applyImport(port, env);
    expect(inserted).toHaveLength(1);
    expect(r.created).toHaveLength(1);
    expect(emptyLookups().conversionTypeKeys.size).toBe(0); // sanity do helper
  });
});
