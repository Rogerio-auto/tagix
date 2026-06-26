/**
 * Preview e aplicação do import de Flows (F50-S03). PURO (orquestra sobre o `BackupDbPort`):
 *  - `previewImport`: sem escrita — checksum, validação, colisão de nome, referências
 *    resolvidas vs não-resolvidas, avisos de versão.
 *  - `applyImport`: ADITIVO e SEGURO — cria flows SEMPRE como rascunho, remapeia referências
 *    (nome/chave → id do destino; go_to_flow intra-bundle por sourceId→newId), sufixa nome em
 *    colisão. `workspaceId`/`createdBy`/`status='draft'` são responsabilidade do port (auth).
 */
import { randomUUID } from 'node:crypto';
import {
  extractReferences,
  refKey,
  rewriteReferences,
  validateFlow,
  FLOW_NODE_TYPES,
  type BackupEnvelope,
  type FlowPreviewEntry,
  type ImportedFlow,
  type ImportResult,
  type PreviewResult,
  type ReferenceResolution,
} from '@hm/flow-engine';
import { verifyChecksum } from './checksum';
import { stageLookupKey, type BackupDbPort, type NewFlowRow, type TargetLookups } from './ports';

/** Sufixa o nome em caso de colisão (com nomes existentes + os já consumidos neste lote). */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  const first = `${base} (importado)`;
  if (!taken.has(first)) return first;
  let n = 2;
  while (taken.has(`${base} (importado ${n})`)) n += 1;
  return `${base} (importado ${n})`;
}

interface Resolution {
  /** UUID kinds: `${kind}:${oldId}` → newId | null (clear). conversionType/media ficam de fora. */
  readonly idMap: Map<string, string | null>;
  /** Status por referência (para o preview), por refKey. */
  readonly byRefKey: Map<string, ReferenceResolution>;
}

/**
 * Resolve todas as referências do bundle contra o workspace destino.
 * `resolveFlow` injeta a estratégia de flow: no preview marca bundle-interno como resolvido
 * (sentinela = próprio sourceId); no apply mapeia para o newId pré-alocado.
 */
function buildResolution(
  envelope: BackupEnvelope,
  lookups: TargetLookups,
  resolveFlow: (sourceValue: string, name: string) => string | null,
): Resolution {
  const ref = envelope.references;
  const tagName = new Map(ref.tags.map((t) => [t.id, t.name]));
  const stageDesc = new Map(ref.stages.map((s) => [s.id, s]));
  const pipelineName = new Map(ref.pipelines.map((p) => [p.id, p.name]));
  const agentName = new Map(ref.agents.map((a) => [a.id, a.name]));
  const channelLabel = new Map(ref.channels.map((c) => [c.id, c.label]));
  const memberEmail = new Map(ref.members.map((m) => [m.id, m.email]));
  const memberLabel = new Map(ref.members.map((m) => [m.id, m.name ?? m.email]));
  const flowName = new Map(ref.flows.map((f) => [f.id, f.name]));
  const convName = new Map(ref.conversionTypes.map((c) => [c.key, c.name]));

  const idMap = new Map<string, string | null>();
  const byRefKey = new Map<string, ReferenceResolution>();

  for (const occ of envelope.flows.flatMap((f) => extractReferences(f))) {
    if (occ.kind === 'media') continue;
    const rk = refKey(occ.kind, occ.value);
    if (byRefKey.has(rk)) continue;

    let label = occ.value;
    let resolvedId: string | null = null;

    switch (occ.kind) {
      case 'tag':
        label = tagName.get(occ.value) ?? occ.value;
        resolvedId = lookups.tagIdByName.get(label) ?? null;
        idMap.set(rk, resolvedId);
        break;
      case 'stage': {
        const d = stageDesc.get(occ.value);
        label = d?.name ?? occ.value;
        resolvedId =
          (d ? lookups.stageIdByPipelineName.get(stageLookupKey(d.pipelineName, d.name)) : undefined) ??
          lookups.stageIdByName.get(label) ??
          null;
        idMap.set(rk, resolvedId);
        break;
      }
      case 'pipeline':
        label = pipelineName.get(occ.value) ?? occ.value;
        resolvedId = lookups.pipelineIdByName.get(label) ?? null;
        idMap.set(rk, resolvedId);
        break;
      case 'agent':
        label = agentName.get(occ.value) ?? occ.value;
        resolvedId = lookups.agentIdByName.get(label) ?? null;
        idMap.set(rk, resolvedId);
        break;
      case 'channel':
        label = channelLabel.get(occ.value) ?? occ.value;
        resolvedId = lookups.channelIdByName.get(label) ?? null;
        idMap.set(rk, resolvedId);
        break;
      case 'member': {
        const email = memberEmail.get(occ.value);
        label = memberLabel.get(occ.value) ?? occ.value;
        resolvedId = email ? (lookups.memberIdByEmail.get(email) ?? null) : null;
        idMap.set(rk, resolvedId);
        break;
      }
      case 'flow':
        label = flowName.get(occ.value) ?? occ.value;
        resolvedId = resolveFlow(occ.value, label);
        idMap.set(rk, resolvedId);
        break;
      case 'conversionType':
        // Key-based: portável. Resolvido se a key existir no destino; NÃO entra no idMap
        // (a key é preservada; o handler no-opa em runtime se faltar).
        label = convName.get(occ.value) ?? occ.value;
        resolvedId = lookups.conversionTypeKeys.has(occ.value) ? occ.value : null;
        break;
    }

    byRefKey.set(rk, { kind: occ.kind, sourceValue: occ.value, label, resolvedId });
  }

  return { idMap, byRefKey };
}

function validate(entry: BackupEnvelope['flows'][number]): { valid: boolean; errors: number; warnings: number } {
  const v = validateFlow({ nodes: entry.nodes, edges: entry.edges } as unknown as Parameters<typeof validateFlow>[0]);
  return {
    valid: v.valid,
    errors: v.issues.filter((i) => i.severity === 'error').length,
    warnings: v.issues.filter((i) => i.severity === 'warning').length,
  };
}

const KNOWN_NODE_TYPES = new Set<string>(FLOW_NODE_TYPES as readonly string[]);

export async function previewImport(
  port: BackupDbPort,
  envelope: BackupEnvelope,
): Promise<PreviewResult> {
  const checksumValid = verifyChecksum(envelope);
  const existingNames = await port.existingFlowNames();
  const lookups = await port.loadTargetLookups(envelope.references);
  const bundleSourceIds = new Set(envelope.flows.map((f) => f.sourceId));
  const resolveFlow = (v: string, name: string): string | null =>
    bundleSourceIds.has(v) ? v : (lookups.flowIdByName.get(name) ?? null);
  const { byRefKey } = buildResolution(envelope, lookups, resolveFlow);

  const taken = new Set(existingNames);
  const flows: FlowPreviewEntry[] = envelope.flows.map((entry) => {
    const nameCollision = existingNames.has(entry.name);
    const finalName = uniqueName(entry.name, taken);
    taken.add(finalName);

    const unresolved: ReferenceResolution[] = [];
    const seen = new Set<string>();
    let resolved = 0;
    let mediaWarnings = 0;
    for (const o of extractReferences(entry)) {
      if (o.kind === 'media') {
        mediaWarnings += 1;
        continue;
      }
      const rk = refKey(o.kind, o.value);
      if (seen.has(rk)) continue;
      seen.add(rk);
      const r = byRefKey.get(rk);
      if (!r) continue;
      if (r.resolvedId === null) unresolved.push(r);
      else resolved += 1;
    }

    const versionWarnings: string[] = [];
    const unknownTypes = [
      ...new Set(
        entry.nodes
          .map((n) => (n as { type?: string }).type)
          .filter((t): t is string => typeof t === 'string' && !KNOWN_NODE_TYPES.has(t)),
      ),
    ];
    if (unknownTypes.length > 0)
      versionWarnings.push(`Tipos de nó desconhecidos: ${unknownTypes.join(', ')}`);

    return {
      sourceId: entry.sourceId,
      name: entry.name,
      nameCollision,
      finalName,
      nodeCount: entry.nodes.length,
      edgeCount: entry.edges.length,
      validation: validate(entry),
      resolvedReferences: resolved,
      unresolvedReferences: unresolved,
      mediaWarnings,
      versionWarnings,
    };
  });

  return {
    checksumValid,
    formatVersion: envelope.formatVersion,
    flowCount: envelope.flows.length,
    flows,
  };
}

export interface ApplyOptions {
  /** Reservado para overwrite/merge futuros; v1 só 'add' (aditivo). */
  readonly mode?: 'add';
}

export async function applyImport(
  port: BackupDbPort,
  envelope: BackupEnvelope,
  _opts: ApplyOptions = {},
): Promise<ImportResult> {
  const existingNames = await port.existingFlowNames();
  const lookups = await port.loadTargetLookups(envelope.references);
  const sourceIdToNewId = new Map(envelope.flows.map((f) => [f.sourceId, randomUUID()]));
  const resolveFlow = (v: string, name: string): string | null =>
    sourceIdToNewId.get(v) ?? lookups.flowIdByName.get(name) ?? null;
  const { idMap } = buildResolution(envelope, lookups, resolveFlow);

  const taken = new Set(existingNames);
  const rows: NewFlowRow[] = [];
  const created: ImportedFlow[] = [];

  for (const entry of envelope.flows) {
    const finalName = uniqueName(entry.name, taken);
    taken.add(finalName);
    const r = rewriteReferences(entry, idMap);
    const newId = sourceIdToNewId.get(entry.sourceId)!;
    rows.push({
      id: newId,
      name: finalName,
      description: r.description ?? null,
      triggerType: r.triggerType,
      triggerConfig: r.triggerConfig ?? {},
      filterStatus: r.filterStatus ?? null,
      filterStageIds: r.filterStageIds ?? null,
      filterTagIds: r.filterTagIds ?? null,
      channelIds: r.channelIds ?? null,
      nodes: r.nodes,
      edges: r.edges,
      schemaVersion: r.schemaVersion,
    });
    created.push({ sourceId: entry.sourceId, newId, finalName });
  }

  await port.insertFlows(rows);

  const unresolvedReferencesCleared = [...idMap.values()].filter((v) => v === null).length;
  return { created, skipped: [], unresolvedReferencesCleared, warnings: [] };
}
