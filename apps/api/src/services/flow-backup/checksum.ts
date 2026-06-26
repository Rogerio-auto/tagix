/**
 * Checksum sha256 do backup (F50-S03). Calculado sobre a serialização CANÔNICA (`canonicalize`
 * de @hm/flow-engine) de `{ flows, references }` — determinístico, igual no export e no import.
 */
import { createHash } from 'node:crypto';
import { canonicalize, type BackupChecksum, type BackupEnvelope } from '@hm/flow-engine';

export function computeChecksum(payload: { flows: unknown; references: unknown }): BackupChecksum {
  const value = createHash('sha256').update(canonicalize(payload)).digest('hex');
  return { algo: 'sha256', value };
}

/** True se o checksum declarado bate com o recomputado sobre flows+references. */
export function verifyChecksum(envelope: BackupEnvelope): boolean {
  const expected = computeChecksum({ flows: envelope.flows, references: envelope.references });
  return expected.value === envelope.checksum.value;
}
