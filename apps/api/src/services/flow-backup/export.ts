/**
 * Montagem do bundle de export (F50-S03). Lê os flows (grafo DRAFT) via port, extrai e
 * enriquece referências (id→nome) e assina com checksum. Exclui versions/executions/logs.
 *
 * O envelope é NORMALIZADO via os schemas Zod ANTES do checksum, garantindo que o import
 * (que re-parseia com os mesmos schemas) recompute exatamente o mesmo hash.
 */
import {
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  extractReferences,
  flowBackupEntrySchema,
  referenceIndexSchema,
  type BackupEnvelope,
  type FlowBackupEntry,
} from '@hm/flow-engine';
import { computeChecksum } from './checksum';
import type { BackupDbPort, RawFlowRow } from './ports';

function toEntry(row: RawFlowRow): FlowBackupEntry {
  return flowBackupEntrySchema.parse({
    sourceId: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.triggerType,
    triggerConfig: row.triggerConfig ?? {},
    filterStatus: row.filterStatus,
    filterStageIds: row.filterStageIds,
    filterTagIds: row.filterTagIds,
    channelIds: row.channelIds,
    nodes: row.nodes ?? [],
    edges: row.edges ?? [],
    schemaVersion: row.schemaVersion,
  });
}

export interface ExportOptions {
  readonly flowIds?: readonly string[];
}

/** Constrói o envelope de backup de todos os flows (ou o subset `flowIds`). */
export async function buildExportBundle(
  port: BackupDbPort,
  opts: ExportOptions = {},
): Promise<BackupEnvelope> {
  const rows = await port.listFlows(opts.flowIds);
  const flows = rows.map(toEntry);

  const occurrences = flows.flatMap((f) => extractReferences(f));
  const references = referenceIndexSchema.parse(await port.describeReferences(occurrences));

  const checksum = computeChecksum({ flows, references });
  const schemaVersion = flows.reduce((max, f) => Math.max(max, f.schemaVersion), 1);

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    app: BACKUP_APP,
    exportedAt: new Date().toISOString(),
    schemaVersion,
    checksum,
    flows,
    references,
  };
}
