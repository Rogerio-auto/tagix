/**
 * Extração e reescrita de referências workspace-específicas de um flow (F50). PURO (sem DB):
 * varre o grafo + metadata + triggerConfig e enumera todo UUID/key que aponta para fora do
 * grafo. Usado pelo serviço da API (S03) para enriquecer o export (id→nome) e remapear no
 * import (nome→id do destino).
 *
 * Fonte da verdade dos campos: os handlers em `../handlers/*.handler.ts` (campos confirmados
 * por inspeção). Mantém o UUID no `node.data` (válido para os schemas dos handlers) — os
 * descritores legíveis vivem num índice separado (`ReferenceIndex`).
 */
import type { FlowBackupEntry, ReferenceKind, UuidReferenceKind } from './envelope';

/** Uma ocorrência de referência encontrada num flow. */
export interface RefOccurrence {
  readonly kind: ReferenceKind;
  /** valor atual: UUID (uuid kinds), key (conversionType) ou storage key (media). */
  readonly value: string;
  /** id do nó de origem (ausente quando vem do nível flow/triggerConfig). */
  readonly nodeId?: string;
  /** caminho lógico (diagnóstico/preview). */
  readonly path: string;
}

/** Campos de `node.data` que carregam UUID de entidade, por tipo de nó. */
const NODE_UUID_REF_FIELDS: Readonly<Record<string, readonly { field: string; kind: UuidReferenceKind }[]>> = {
  condition: [
    { field: 'tagId', kind: 'tag' },
    { field: 'stageId', kind: 'stage' },
  ],
  move_stage: [
    { field: 'stageId', kind: 'stage' },
    { field: 'pipelineId', kind: 'pipeline' },
  ],
  add_tag: [{ field: 'tagId', kind: 'tag' }],
  remove_tag: [{ field: 'tagId', kind: 'tag' }],
  ai_action: [{ field: 'agentId', kind: 'agent' }],
  assign: [{ field: 'memberId', kind: 'member' }],
  go_to_flow: [{ field: 'flowId', kind: 'flow' }],
  external_notify: [{ field: 'channelId', kind: 'channel' }],
};

/** Campos de `node.data` que são chaves de mídia (só-aviso: não migram entre ambientes). */
const NODE_MEDIA_FIELDS: Readonly<Record<string, readonly string[]>> = {
  message: ['mediaStorageKey', 'mediaUrl'],
  external_notify: ['mediaUrl'],
  wait_for_response: ['mediaUrl'],
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Chave canônica para o idMap de reescrita: `${kind}:${value}`. */
export function refKey(kind: ReferenceKind, value: string): string {
  return `${kind}:${value}`;
}

/**
 * Enumera todas as referências externas de um flow (nível flow + triggerConfig + nós).
 * `conversionType` e `media` entram como ocorrências (para o índice/preview) mas NÃO são
 * reescritas por `rewriteReferences` (key é portável; mídia é só aviso).
 */
export function extractReferences(entry: FlowBackupEntry): RefOccurrence[] {
  const out: RefOccurrence[] = [];

  const pushArray = (arr: readonly string[] | null | undefined, kind: UuidReferenceKind, base: string): void => {
    if (!arr) return;
    arr.forEach((value, i) => {
      if (isNonEmptyString(value)) out.push({ kind, value, path: `${base}[${i}]` });
    });
  };

  // Nível flow: filtros.
  pushArray(entry.filterStageIds, 'stage', 'filterStageIds');
  pushArray(entry.filterTagIds, 'tag', 'filterTagIds');
  pushArray(entry.channelIds, 'channel', 'channelIds');

  // triggerConfig: stage_change / tag_added.
  const tc = entry.triggerConfig ?? {};
  if (entry.triggerType === 'stage_change') {
    if (isNonEmptyString(tc['from_stage_id']))
      out.push({ kind: 'stage', value: tc['from_stage_id'], path: 'triggerConfig.from_stage_id' });
    if (isNonEmptyString(tc['to_stage_id']))
      out.push({ kind: 'stage', value: tc['to_stage_id'], path: 'triggerConfig.to_stage_id' });
  }
  if (entry.triggerType === 'tag_added' && isNonEmptyString(tc['tag_id']))
    out.push({ kind: 'tag', value: tc['tag_id'], path: 'triggerConfig.tag_id' });

  // Nós.
  for (const node of entry.nodes) {
    const data = asRecord(node.data);
    if (!data) continue;

    for (const { field, kind } of NODE_UUID_REF_FIELDS[node.type] ?? []) {
      if (isNonEmptyString(data[field]))
        out.push({ kind, value: data[field], nodeId: node.id, path: `node.data.${field}` });
    }

    if (node.type === 'register_conversion') {
      const key = data['conversionTypeKey'] ?? data['conversionType'];
      if (isNonEmptyString(key))
        out.push({ kind: 'conversionType', value: key, nodeId: node.id, path: 'node.data.conversionTypeKey' });
    }

    for (const field of NODE_MEDIA_FIELDS[node.type] ?? []) {
      if (isNonEmptyString(data[field]))
        out.push({ kind: 'media', value: data[field], nodeId: node.id, path: `node.data.${field}` });
    }
  }

  return out;
}

/**
 * idMap: `${kind}:${oldValue}` →
 *   - `string` (novo id no destino) ⇒ reescreve o campo,
 *   - `null` (não resolvido) ⇒ limpa o campo (array: descarta entrada),
 *   - ausente ⇒ mantém o valor original.
 * Apenas UUID kinds são reescritos (conversionType/media nunca entram no idMap).
 */
export type RefIdMap = ReadonlyMap<string, string | null>;

type RewriteAction = { action: 'keep' } | { action: 'set'; id: string } | { action: 'clear' };

function resolveAction(idMap: RefIdMap, kind: UuidReferenceKind, value: string): RewriteAction {
  const key = refKey(kind, value);
  if (!idMap.has(key)) return { action: 'keep' };
  const v = idMap.get(key) ?? null;
  return v === null ? { action: 'clear' } : { action: 'set', id: v };
}

function rewriteArray(
  arr: string[] | null | undefined,
  kind: UuidReferenceKind,
  idMap: RefIdMap,
): string[] | null | undefined {
  if (!arr) return arr;
  const next: string[] = [];
  for (const value of arr) {
    if (!isNonEmptyString(value)) continue;
    const a = resolveAction(idMap, kind, value);
    if (a.action === 'clear') continue; // descarta referência não resolvida
    next.push(a.action === 'set' ? a.id : value);
  }
  return next;
}

function rewriteField(
  obj: Record<string, unknown>,
  field: string,
  kind: UuidReferenceKind,
  idMap: RefIdMap,
): void {
  const value = obj[field];
  if (!isNonEmptyString(value)) return;
  const a = resolveAction(idMap, kind, value);
  if (a.action === 'set') obj[field] = a.id;
  else if (a.action === 'clear') delete obj[field];
}

/**
 * Devolve uma cópia do flow com os UUIDs remapeados pelo idMap. Não muta a entrada.
 * Referências não resolvidas são LIMPAS (no-op seguro: a importação é sempre como rascunho,
 * e o preview lista o que precisa ser reconfigurado antes de publicar).
 */
export function rewriteReferences(entry: FlowBackupEntry, idMap: RefIdMap): FlowBackupEntry {
  const clone = structuredClone(entry) as FlowBackupEntry & {
    filterStageIds?: string[] | null;
    filterTagIds?: string[] | null;
    channelIds?: string[] | null;
    triggerConfig: Record<string, unknown>;
  };

  clone.filterStageIds = rewriteArray(clone.filterStageIds, 'stage', idMap);
  clone.filterTagIds = rewriteArray(clone.filterTagIds, 'tag', idMap);
  clone.channelIds = rewriteArray(clone.channelIds, 'channel', idMap);

  const tc = clone.triggerConfig;
  if (tc && typeof tc === 'object') {
    if (clone.triggerType === 'stage_change') {
      rewriteField(tc, 'from_stage_id', 'stage', idMap);
      rewriteField(tc, 'to_stage_id', 'stage', idMap);
    }
    if (clone.triggerType === 'tag_added') rewriteField(tc, 'tag_id', 'tag', idMap);
  }

  for (const node of clone.nodes) {
    const data = asRecord(node.data);
    if (!data) continue;
    for (const { field, kind } of NODE_UUID_REF_FIELDS[node.type] ?? []) {
      rewriteField(data, field, kind, idMap);
    }
  }

  return clone;
}
