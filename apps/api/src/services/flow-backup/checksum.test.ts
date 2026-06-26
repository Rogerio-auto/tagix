import { describe, expect, it } from 'vitest';
import { referenceIndexSchema, type BackupEnvelope } from '@hm/flow-engine';
import { computeChecksum, verifyChecksum } from './checksum';

const refs = referenceIndexSchema.parse({});
const flows = [
  {
    sourceId: '11111111-1111-1111-1111-111111111111',
    name: 'F',
    triggerType: 'manual',
    triggerConfig: {},
    nodes: [{ id: 'n1', type: 'trigger', data: {} }],
    edges: [],
    schemaVersion: 1,
  },
];

function envelope(): BackupEnvelope {
  return {
    formatVersion: 1,
    app: 'leadium',
    exportedAt: '2026-06-26T00:00:00.000Z',
    schemaVersion: 1,
    checksum: computeChecksum({ flows, references: refs }),
    flows: flows as never,
    references: refs,
  };
}

describe('checksum', () => {
  it('verifyChecksum aceita o checksum recomputado', () => {
    expect(verifyChecksum(envelope())).toBe(true);
  });

  it('rejeita checksum adulterado', () => {
    const e = { ...envelope(), checksum: { algo: 'sha256' as const, value: 'f'.repeat(64) } };
    expect(verifyChecksum(e)).toBe(false);
  });

  it('rejeita quando o conteúdo muda mas o checksum não', () => {
    const e = envelope();
    const tampered = { ...e, flows: [{ ...flows[0], name: 'OUTRO' }] as never };
    expect(verifyChecksum(tampered)).toBe(false);
  });

  it('é estável (mesmo conteúdo → mesmo hash)', () => {
    expect(computeChecksum({ flows, references: refs }).value).toBe(
      computeChecksum({ flows, references: refs }).value,
    );
  });
});
