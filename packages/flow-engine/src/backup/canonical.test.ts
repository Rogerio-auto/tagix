import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical';
import { backupEnvelopeSchema } from './envelope';

describe('canonicalize', () => {
  it('é estável independente da ordem das chaves', () => {
    const a = canonicalize({ flows: [{ b: 1, a: 2 }], references: { z: 1, a: 2 } });
    const b = canonicalize({ references: { a: 2, z: 1 }, flows: [{ a: 2, b: 1 }] });
    expect(a).toBe(b);
  });

  it('ordena chaves recursivamente', () => {
    const s = canonicalize({ flows: [{ y: { d: 1, c: 2 }, x: 3 }], references: {} });
    expect(s).toBe('{"flows":[{"x":3,"y":{"c":2,"d":1}}],"references":{}}');
  });

  it('trata undefined como null em arrays e omite chaves undefined', () => {
    const s = canonicalize({ flows: [undefined, { a: undefined, b: 1 }], references: {} });
    expect(s).toBe('{"flows":[null,{"b":1}],"references":{}}');
  });

  it('só considera flows e references (ignora outros campos)', () => {
    const s = canonicalize({ flows: [], references: {}, extra: 'x' } as never);
    expect(s).toBe('{"flows":[],"references":{}}');
  });
});

describe('backupEnvelopeSchema', () => {
  const valid = {
    formatVersion: 1,
    app: 'leadium',
    exportedAt: '2026-06-26T00:00:00.000Z',
    schemaVersion: 1,
    checksum: { algo: 'sha256', value: 'a'.repeat(64) },
    flows: [
      {
        sourceId: '11111111-1111-1111-1111-111111111111',
        name: 'F',
        triggerType: 'manual',
        triggerConfig: {},
        nodes: [{ id: 'n1', type: 'trigger', data: {} }],
        edges: [],
        schemaVersion: 1,
      },
    ],
    references: {},
  };

  it('aceita envelope válido (com defaults de references)', () => {
    const r = backupEnvelopeSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.references.tags).toEqual([]);
  });

  it('rejeita app errado', () => {
    expect(backupEnvelopeSchema.safeParse({ ...valid, app: 'outro' }).success).toBe(false);
  });

  it('rejeita formatVersion diferente de 1', () => {
    expect(backupEnvelopeSchema.safeParse({ ...valid, formatVersion: 2 }).success).toBe(false);
  });

  it('rejeita chave extra (arquivo adulterado/incompatível)', () => {
    expect(backupEnvelopeSchema.safeParse({ ...valid, hacked: true }).success).toBe(false);
  });

  it('rejeita checksum fora do formato sha256-hex', () => {
    expect(
      backupEnvelopeSchema.safeParse({ ...valid, checksum: { algo: 'sha256', value: 'xyz' } }).success,
    ).toBe(false);
  });

  it('rejeita flows vazio', () => {
    expect(backupEnvelopeSchema.safeParse({ ...valid, flows: [] }).success).toBe(false);
  });
});
